# 无障碍 AI 体验评测工具 MVP

通见是一个面向 UED + QA 的无障碍走查 MVP。它以可访问 URL 为输入，使用 Playwright 打开真实页面，结合 axe-core、DOM 信号、键盘行为、组件规则和 Gemini AI 生成可复核、可分派、可修复的问题报告。

## 能力边界

- 验收基线：WCAG 2.2 AA。
- 自动规则：颜色对比、alt、label、可访问名称、ARIA、语义结构等 axe-core 可覆盖问题。
- 行为检测：Tab 路径、焦点可见性、疑似键盘陷阱。
- 组件规则：弹窗/抽屉语义、状态反馈是否可被读屏器感知、目标尺寸。
- Gemini AI 语义复核：图片替代文本质量、链接文案上下文、错误提示、图表等价文本、焦点顺序和状态反馈。
- Gemini AI 修复建议：为规则问题补充根因、用户影响、研发修复建议、UED 建议、示例代码和可复制 issue 文案。
- 人工仍需确认：真实读屏体验、复杂业务流程、认知理解、字幕/音频描述质量。

## 安装

```bash
npm install
```

如本机没有 Playwright 浏览器：

```bash
npx playwright install chromium
```

## Gemini AI 配置

Gemini Key 只通过环境变量读取，不要写入源码、README、Notion 或报告文件：

```bash
export GEMINI_API_KEY="你的 Gemini API Key"
```

可选指定模型，默认优先使用 `gemini-3.5-flash`，并在高峰、限流或超时时自动切到备用模型：

```bash
export GEMINI_MODEL="gemini-3.5-flash"
export GEMINI_FALLBACK_MODELS="gemini-2.5-flash,gemini-2.5-flash-lite"
```

调用稳定性也可以通过以下参数调整：

```bash
export GEMINI_TIMEOUT_MS="90000"
export GEMINI_MAX_ATTEMPTS="2"
export GEMINI_RETRY_DELAY_MS="800"
```

Web App：页面走查会默认尝试运行 AI 语义复核；如果未设置 `GEMINI_API_KEY` 或调用失败，报告会明确展示未运行/降级状态，并继续输出自动规则结果。

CLI：默认不启用 AI，避免批量走查产生意外 API 成本。需要 AI 时显式加 `--ai`。

## 使用

启动本地 Web App：

```bash
npm run dev
```

打开：

```text
http://127.0.0.1:3000
```

页面里的运行参数含义：

- `视口`：模拟桌面、笔记本或移动端尺寸，用来发现响应式布局、触控目标和换行问题。
- `键盘遍历次数`：工具连续按 Tab 的次数，用来检查焦点顺序、焦点可见性和疑似键盘陷阱。
- `自然语言任务`：用一句话描述要验收的业务路径，工具会生成并执行点击、填写、等待等动作；每个步骤执行后会采样当前状态，覆盖弹窗、表单错误、loading、toast 等流程中的无障碍问题，最终状态仍会做完整走查。

走查单个页面：

```bash
npm run audit -- --url https://example.com --name "示例页面"
```

走查单个页面并启用 Gemini AI：

```bash
npm run audit -- --url https://example.com --name "示例页面" --ai
```

走查带操作步骤的场景：

```bash
npm run audit -- --scenario ./a11y.scenario.example.json
```

通见支持自然语言生成步骤：填写 `任务路径` 后点击 `生成步骤` 可预览和微调；也可以直接点击 `开始走查`，后端会自动解析并执行。没有配置 Gemini 时会使用本地规则解析常见登录、表单、弹窗、toast、按键和等待路径；配置 Gemini 后会优先用 AI 生成候选步骤，并保留本地规则兜底。

## 线上部署

通见不能只部署 `dist/` 静态文件。页面走查依赖 Node 服务启动 Playwright / Chromium，并提供 `/api/audit`、`/api/steps`、`/api/reports` 和 `/reports/*`。如果将前端发布到纯静态托管，`/api/audit` 通常会被回退为 `index.html`，页面就会提示“后端服务返回了非 JSON 内容”。

推荐用仓库内的 Dockerfile 部署前后端一体服务：

```bash
docker build -t tongjian .
docker run --rm --init \
  -p 3000:3000 \
  -e GEMINI_API_KEY="你的 Gemini API Key" \
  -v tongjian-reports:/app/reports \
  tongjian
```

部署平台需要满足：

- 支持长时间运行的 Node 容器和 Chromium 依赖，不能使用纯静态托管或仅 Serverless Function 的运行时。
- 将平台提供的 `PORT` 注入容器；服务已默认监听 `0.0.0.0`。
- 同一个域名下把 `/`、`/api/*` 和 `/reports/*` 都转发给该容器，不要把 `/api/*` 重写到 `index.html`。
- 为 `/app/reports` 挂载持久化卷，否则容器重启后历史报告会丢失。
- 允许容器访问被走查网站和 Gemini API（如启用 AI）。

也可以不用 Docker，在具备 Chromium 系统依赖的 Linux 主机执行：

```bash
npm ci
npx playwright install --with-deps chromium
npm run build
PORT=3000 HOST=0.0.0.0 npm run start
```

安全提示：线上实例会代表服务端访问用户提交的 URL。公开部署前应在反向代理或应用层加认证、访问频率限制，并限制可走查的域名范围，避免成为开放的内网访问入口。

自然语言生成步骤接口：

```bash
curl -s -X POST http://127.0.0.1:3000/api/steps \
  -H 'content-type: application/json' \
  -d '{"task":"邮箱: qa@example.com，密码: test123，然后点击登录，等待 toast","ai":{"enabled":false}}'
```

运行本地示例页面：

```bash
npm run audit -- --url "file:///Volumes/vibecoding/A11y/examples/sample-target.html" --name "示例缺陷页"
```

## 输出

每次运行会在 `reports/<页面名>-<时间戳>/` 下生成：

- `report.md`：给 UED、QA、研发阅读的走查报告。
- `audit.json`：完整机器可读结果。
- `screenshot.png`：全页截图证据。
- `dom-snapshot.html`：走查时的 DOM 快照。
- `accessibility-tree.json`：浏览器可访问性树。

每个问题都包含规则来源、影响用户、复现步骤、证据、严重级别、修复建议和责任角色。启用 Gemini 后，`audit.json` 会额外包含 `ai` 字段，报告中会出现 AI 走查摘要、AI 语义复核项和 AI 增强修复建议。

## 场景文件格式

```json
{
  "targets": [
    {
      "name": "登录页",
      "url": "https://example.com/login",
      "notes": "测试环境或账号说明",
      "steps": [
        { "action": "fill", "selector": "#email", "value": "qa@example.com" },
        { "action": "click", "selector": "button[type='submit']" },
        { "action": "waitForSelector", "selector": ".toast" }
      ]
    }
  ]
}
```

支持的步骤：

- `fill`
- `click`
- `press`
- `waitForSelector`
- `wait`

## 验证

```bash
npm test
```

本地 Web App 启动后，可运行端到端页面验证：

```bash
npm run check:web
```
