# 一句一游戏

固定标题栏、用户名注册/登录功能。无需邮箱。登录后显示默认头像，悬停头像显示账户菜单，也支持点击和键盘操作。个人资料、库、收藏历史暂为占位入口；退出账号可清除登录会话并恢复登录按钮。

首页对话框已对接 DeepSeek Responses API。登录后输入游戏想法并发送，AI 返回完整单文件 HTML，服务器自动新建文件并打开游戏预览。支持 Ctrl/Cmd + Enter 生成，后续描述修改需求会生成新版本文件，旧版本保留。纯聊天不创建游戏文件。图片支持 PNG、JPG、WebP、GIF，最多 6 张，每张不超过 10 MB。仅点击发送时才上传文字和图片给 DeepSeek。失败时保留草稿，可再次发送。

生成文件保存在 `data/games/<唯一ID>.html`（自定义 DATA_DIR 时跟随数据库目录），数据库保存所属账号和标题。预览地址 `/play/<ID>`，需要登录同一账号。生成后新标签页自动打开；浏览器拦截弹窗时在当前标签页打开。对话中保留“打开游戏”和“下载 HTML”链接。预览在隔离 iframe 中运行游戏，禁止游戏访问网站账户、外部网络或跳转父页面。生成文件属于运行数据，不提交到 Git；备份 data 目录可保留账户及游戏。AI 生成的玩法和代码仍可能存在问题，可继续要求修改。

## 配置 AI

本地 `.env` 已建立（不提交 Git）；部署时复制 `.env.example` 为 `.env`。填写 `DEEPSEEK_API_KEY`，模型默认 `DEEPSEEK_MODEL=deepseek-flash`，支持图片输入。修改后重启 `npm start`。未填写密钥时显示“AI 暂不可用”，不会生成模拟回复。密钥只由后端读取，不返回给浏览器；旧的 `OPENAI_API_KEY` 不再使用。

实现依据 [DeepSeek Responses API 文档](https://api-docs.deepseek.com/api/create-response/)，通过 `https://api.deepseek.com/responses` 请求，使用非思考模式响应。真实调用需要有效 DeepSeek API 密钥、可用余额和能访问 DeepSeek 的网络。密钥可在 [DeepSeek 开放平台](https://platform.deepseek.com/) 创建。

若需要网络代理，在 `.env` 配置 `HTTPS_PROXY=http://127.0.0.1:代理端口`，并设置 `NO_PROXY=localhost,127.0.0.1`。`npm start` 会在启动前读取配置并启用 Node.js 的环境变量代理。无需代理时留空；不要将此电脑的代理地址写入公开部署配置。

对话上下文按登录会话隔离，服务端内存保留最近 2 轮文字及游戏 HTML，上下文闲置一小时后清理；每个会话最多每小时 30 次，且不允许同时发送多个请求。图片不保留在服务端历史。退出账号清除该会话上下文并取消页面中的请求。页面刷新清空显示记录，服务重启清空上下文。不在本地数据库存储聊天内容。游戏保存在独立 HTML 文件中。

标题栏的首页、动态、作品居中。动态支持切换至 `#activity`，显示“暂无动态”，导航右侧出现发布加号（发布功能尚未开放）。首页与动态切换保留输入草稿和图片；作品暂为占位入口。

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

AI API：`GET /api/ai/status` 返回是否配置服务；`POST /api/chat` 接收 `{ "text": "内容", "images": ["data:image/png;base64,..."] }`，需要登录，返回 `{ "reply": "AI 回复", "game": { "id": "唯一ID", "title": "标题", "filename": "文件名", "url": "预览地址", "downloadUrl": "下载地址" } }`；纯聊天时 game 为 null。图片通过服务端转发，不接受任意远程图片网址。

实现使用 Node.js 内置 [SQLite](https://nodejs.org/api/sqlite.html) 和 [crypto](https://nodejs.org/api/crypto.html)，无需安装第三方运行依赖。
