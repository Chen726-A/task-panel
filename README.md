# 任务面板 — 保持专注

橙色系简约任务管理 PWA，支持主线任务 & 副线任务。

## 部署到 Render（免费）

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Chen726-A/task-panel)

1. 点击上方按钮 → 用 GitHub 登录 Render
2. 在 Environment Variables 中添加：
   - `TURSO_URL` = `libsql://task-panel-chen726-a.aws-ap-northeast-1.turso.io`
   - `TURSO_AUTH_TOKEN` = （见 .env 文件或 Turso Dashboard）
3. 点击 **Deploy**，等待 2-3 分钟

部署完成后通过 Render 分配的域名（如 `https://task-panel.onrender.com`）即可在手机和电脑上访问。

## 本地运行

```bash
npm install
npm start
```

- 默认使用本地 SQLite 数据库
- 设置 `TURSO_URL` 和 `TURSO_AUTH_TOKEN` 环境变量可切换到 Turso 云数据库

## 技术栈

- Express.js + SQLite（本地 sql.js / 云 Turso）
- PWA（可安装到手机桌面，离线可用）
- 橙色极简 UI
