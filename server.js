require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3456;
const USE_TURSO = !!process.env.TURSO_URL; // 有 TURSO_URL 环境变量则用云数据库

// ── 数据库层 ──
let db; // { queryAll, queryOne, exec, close } — 统一接口

function now() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ── 方案 A：本地 sql.js ──
async function initLocal() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'tasks.db');

  // 确保数据库目录存在（云环境可能需要创建）
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  let raw;
  if (fs.existsSync(DB_PATH)) {
    raw = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    raw = new SQL.Database();
  }

  raw.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      category    TEXT    NOT NULL,
      completed   INTEGER NOT NULL DEFAULT 0,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL
    )
  `);
  try { raw.run("ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''"); } catch (_) {}

  function save() { fs.writeFileSync(DB_PATH, Buffer.from(raw.export())); }
  save();

  db = {
    queryAll(sql, params = []) {
      const stmt = raw.prepare(sql); stmt.bind(params);
      const rows = []; while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free(); return rows;
    },
    queryOne(sql, params = []) {
      const rows = this.queryAll(sql, params); return rows[0] || null;
    },
    exec(sql, params = []) {
      raw.run(sql, params); save();
    },
    close() { raw.close(); }
  };
}

// ── 方案 B：Turso 云数据库 ──
async function initTurso() {
  const { createClient } = require('@libsql/client');

  const client = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  await client.execute(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      category    TEXT    NOT NULL,
      completed   INTEGER NOT NULL DEFAULT 0,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL
    )
  `);
  try { await client.execute("ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''"); } catch (_) {}

  db = {
    queryAll(sql, params = []) {
      // @libsql/client 用 ? 占位符和参数数组
      return client.execute({ sql, args: params }).then(r => r.rows);
    },
    queryOne(sql, params = []) {
      return client.execute({ sql, args: params }).then(r => r.rows[0] || null);
    },
    exec(sql, params = []) {
      return client.execute({ sql, args: params });
    },
    close() {}
  };
}

// ── 中间件 ──
app.use(express.json());
app.use(express.static(__dirname));

// ── API 路由（与之前完全一致）──

app.get('/api/tasks', async (_req, res) => {
  const tasks = await db.queryAll('SELECT * FROM tasks ORDER BY order_index ASC, id ASC');
  res.json(tasks);
});

app.post('/api/tasks', async (req, res) => {
  const { title, category, description } = req.body;
  if (!title || !category || !['main', 'side'].includes(category)) {
    return res.status(400).json({ error: 'title 和 category (main/side) 为必填项' });
  }
  const rows = await db.queryAll('SELECT MAX(order_index) AS m FROM tasks WHERE category = ?', [category]);
  const nextOrder = (rows[0] && rows[0].m != null) ? rows[0].m + 1 : 0;

  await db.exec('INSERT INTO tasks (title, description, category, order_index, created_at) VALUES (?, ?, ?, ?, ?)',
    [title, description || '', category, nextOrder, now()]);

  const task = await db.queryOne('SELECT * FROM tasks ORDER BY id DESC LIMIT 1');
  res.status(201).json(task);
});

app.put('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description, category, completed } = req.body;
  const existing = await db.queryOne('SELECT * FROM tasks WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: '任务不存在' });

  await db.exec('UPDATE tasks SET title = ?, description = ?, category = ?, completed = ? WHERE id = ?',
    [title ?? existing.title, description ?? existing.description, category ?? existing.category,
     completed != null ? (completed ? 1 : 0) : existing.completed, id]);

  res.json(await db.queryOne('SELECT * FROM tasks WHERE id = ?', [id]));
});

app.patch('/api/tasks/:id/toggle', async (req, res) => {
  const { id } = req.params;
  const existing = await db.queryOne('SELECT * FROM tasks WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: '任务不存在' });

  await db.exec('UPDATE tasks SET completed = ? WHERE id = ?', [existing.completed ? 0 : 1, id]);
  res.json(await db.queryOne('SELECT * FROM tasks WHERE id = ?', [id]));
});

app.delete('/api/tasks/:id', async (req, res) => {
  const existing = await db.queryOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: '任务不存在' });
  await db.exec('DELETE FROM tasks WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

app.patch('/api/tasks/reorder', async (req, res) => {
  const { category, ids } = req.body;
  if (!category || !Array.isArray(ids)) {
    return res.status(400).json({ error: 'category 和 ids[] 为必填项' });
  }
  for (let i = 0; i < ids.length; i++) {
    await db.exec('UPDATE tasks SET order_index = ? WHERE id = ? AND category = ?', [i, ids[i], category]);
  }
  const tasks = await db.queryAll('SELECT * FROM tasks WHERE category = ? ORDER BY order_index ASC, id ASC', [category]);
  res.json(tasks);
});

// ── 本机 IP 信息 ──
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

// ── 启动 ──
(async () => {
  if (USE_TURSO) {
    console.log('☁️  使用 Turso 云数据库');
    await initTurso();
  } else {
    console.log('💾 使用本地 SQLite 数据库');
    await initLocal();
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ 任务面板已启动 → http://localhost:${PORT}`);
    const ips = getLocalIPs();
    ips.forEach(ip => console.log(`   📱 手机访问 → http://${ip}:${PORT}`));
  });
})();
