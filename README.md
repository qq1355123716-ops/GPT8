# 一句一游戏

固定标题栏、用户名注册/登录功能。无需邮箱。登录后显示默认头像，悬停头像显示账户菜单，也支持点击和键盘操作。个人资料、库、收藏历史暂为占位入口；退出账号可清除登录会话并恢复登录按钮。

首页对话框支持输入游戏想法，左下角可添加图片并预览、移除。支持 PNG、JPG、WebP、GIF，最多 6 张，每张不超过 10 MB。当前未接入 AI，发送按钮暂未开放，文字和图片仅保留在当前页面，不上传、不持久保存。

## 启动

安装 Node.js 24 或以上，运行：

```sh
npm start
```

浏览器打开 http://localhost:3000 。请通过此地址访问，直接双击 HTML 不会启动账户服务。

```sh
npm test
```

账户和会话保存在 `data/accounts.sqlite`，密码使用随机盐与 scrypt 哈希；登录有效期为 7 天。数据库不提交到 Git，请自行备份整个 data 目录。

## 服务部署

GitHub 仓库用于保存源代码。GitHub Pages 仅支持静态页面，不能运行此账户后端。部署到支持 Node.js 24 的服务器，执行 `npm start`，为 data 目录配置持久化存储，并通过 HTTPS 反向代理对外提供服务。

环境变量：`PORT`（默认 3000）、`HOST`（默认 127.0.0.1）、`APP_ORIGIN`（公开访问地址，如 https://example.com，不带末尾斜杠）、`DATA_DIR`（数据库目录）。HTTPS 地址自动启用 Secure Cookie。反向代理应保留 Cookie，并限制请求频率；当前内置限流按直连客户端 IP 计算，不信任代理传入的 IP 请求头。

API：`POST /api/register`、`POST /api/login` 接收 JSON `{ "username": "用户名", "password": "密码" }`；`GET /api/me` 查询当前用户；`POST /api/logout` 退出。POST 需发送 `X-App-Request: 1`，仅支持同源调用。

实现使用 Node.js 内置 [SQLite](https://nodejs.org/api/sqlite.html) 和 [crypto](https://nodejs.org/api/crypto.html)，无需安装第三方运行依赖。
