# 无障碍 AI 体验评测工具 MVP

这是一个面向 UED + QA 验收的无障碍审计 MVP。它以可访问 URL 为输入，使用 Playwright 打开真实页面，结合 axe-core、DOM 信号、键盘行为、组件规则和 Gemini AI 生成可复核、可分派、可修复的问题报告。

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
export GEMINI_THINKING_LEVEL="low"
```

Web App：如果设置了 `GEMINI_API_KEY`，页面里的“启用 AI 语义复核”默认会运行 Gemini；没有 Key 或调用失败时，会自动降级为原有规则报告。

CLI：默认不启用 AI，避免批量审计产生意外 API 成本。需要 AI 时显式加 `--ai`。

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
- `页面操作步骤`：让工具先执行点击、填写、等待等动作，进入弹窗、表单提交后 toast、错误态等需要验收的状态。

审计单个页面：

```bash
npm run audit -- --url https://example.com --name "示例页面"
```

审计单个页面并启用 Gemini AI：

```bash
npm run audit -- --url https://example.com --name "示例页面" --ai
```

审计带操作步骤的场景：

```bash
npm run audit -- --scenario ./a11y.scenario.example.json
```

运行本地示例页面：

```bash
npm run audit -- --url "file:///Volumes/vibecoding/A11y/examples/sample-target.html" --name "示例缺陷页"
```

## 输出

每次运行会在 `reports/<页面名>-<时间戳>/` 下生成：

- `report.md`：给 UED、QA、研发阅读的验收报告。
- `audit.json`：完整机器可读结果。
- `screenshot.png`：全页截图证据。
- `dom-snapshot.html`：审计时的 DOM 快照。
- `accessibility-tree.json`：浏览器可访问性树。

每个问题都包含规则来源、影响用户、复现步骤、证据、严重级别、修复建议和责任角色。启用 Gemini 后，`audit.json` 会额外包含 `ai` 字段，报告中会出现 AI 审计摘要、AI 语义复核项和 AI 增强修复建议。

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
