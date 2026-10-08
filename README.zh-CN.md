<div align="center">

# Smart City Vision Inspector（智慧城市 AI 视觉巡检）

**将视觉大模型应用于一张街景照片，输出引用法规条款、并附整改方案的
结构化隐患报告。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/YiweiOu/smartcity-vision-inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/YiweiOu/smartcity-vision-inspector/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[English](README.md) · 简体中文

</div>

---

## 项目动机

市政巡检采集的影像远超人工能复核的规模。目标检测技术可以给出"灭火器，置信度
0.94"这类结果，但运营团队无法据此采取行动。以下三个问题仍未解决：

| 问题 | 重要性 | 本项目的处理方式 |
|---|---|---|
| 该发现违反了哪项规定？ | 缺少条款依据，结论无法执法、无法复核 | 服务端维护法规知识库，按图片检索并逐条标注到每条隐患 |
| 具体该如何整改？ | 一线人员需要的是动作，而不是标签 | 每条隐患附带可执行的整改措施 |
| 结果是否可信、成本多高？ | 模型输出在不同运行与厂商之间存在波动，token 成本是真实的运营约束 | 风险等级由服务端依据结构化的严重程度字段计算，每次运行记录耗时与 token 用量 |

## 单次分析的输出内容

上传一张照片，返回：

- **场景描述**，以及 Markdown 格式的整体分析；
- **隐患列表**，每条包含 `type`（类型）、`severity`（严重程度，取值 `high`、
  `medium`、`low`）、`evidence`（画面中实际观察到的证据）、`explanation`
  （为何构成风险）与 `regulation`（所违反的条款）；
- **综合判定**与**整改方案**；
- **风险等级**，由服务端依据结构化的严重程度字段计算，与模型自身的措辞无关；
- 本次运行的**耗时与 token 用量**，使模型选型可以基于实测数据比较；
- 完整报告可导出为 **Markdown 或结构化 JSON**。

分析由用户配置的视觉大模型完成，支持 GLM-4V、Kimi、Qwen-VL、混元、DeepSeek、
GPT-4o，以及任何实现 OpenAI 兼容 `/v1/chat/completions` 协议的服务。

![配置面板、知识库与一次巡检结果](docs/screenshots/overview.png)

## 输出示例

以下内容是平台对
[`samples/images/fire/blocked-exit-door.jpg`](samples/images/fire/blocked-exit-door.jpg)
的真实响应，采用知识库增强分析，模型为 `qwen-vl-max`：

```text
Scene     A storage area beside a stainless steel exit door, materials stored
          along both sides of the passage.
Risk      HIGH   (computed server-side from the findings' severities)

Finding 1   Blocked evacuation route                        severity: high
  evidence    Materials are stored directly beside and partially obstructing
              the doorway, reducing clearance.
  why         Stored items near the door impede quick egress in an emergency.
  cited       Fire Protection Law of the PRC (《中华人民共和国消防法》), Art. 28

Finding 2   Obstructed fire service access                  severity: medium
  cited       Fire Protection Law of the PRC (《中华人民共和国消防法》), Art. 28

Finding 3   Improper storage of flammable materials         severity: medium
  cited       Fire Protection Law of the PRC (《中华人民共和国消防法》), Art. 28

Verdict    Multiple fire hazards, primarily blocked exits and improper storage
           of combustible materials.

Remediation  1. Clear all items within 1 m of the door to restore egress.
             2. Relocate flammable materials to designated storage areas.
             3. Keep evacuation routes clear; inspect regularly.

Confidence 0.95 · 36.0 s · 3,856 tokens
```

[`samples/outputs/`](samples/outputs/) 中另附五份报告：灭火器被托盘遮挡、火灾
报警控制器、两起人行道违停，以及一处航拍占道经营场景。每份同时提供 JSON（原始
API 响应，包含 token 用量与检索到的条款）与排版后的 Markdown。

## 功能说明

### 模型接入

标准模式内置 GLM（智谱）、Kimi（Moonshot）、腾讯混元、阿里千问、DeepSeek 以及
通用 OpenAI 兼容网关的预设。高级模式接受任意 `baseURL` 与模型名，并提供视觉能力
标记与 temperature 设置。"获取模型列表"按钮会使用当前配置的 Key 实时查询厂商，
列出该账号当前可访问的模型。

### 法规知识库

法规文档（`.txt`、`.md`、`.json`、`.csv`、`.pdf`）通过界面上传，在服务端分块，
并按中文二元词与英文 token 的重叠度打分。知识库增强模式下分析分为两个阶段：
模型先指出场景并给出 8 至 15 个领域关键词，这些关键词驱动检索，得分最高的条款
被注入用于最终判定的提示词。上文示例中的条款引用即来自这一步骤。

### 场景档案

默认提供四个场景档案：消防隐患、安防监控、交通秩序、治安巡查。每个档案定义了
默认提示词、关键词集与专家角色。新增场景（噪声扰民、垃圾堆放、建筑外立面安全）
只需在 `server.js` 的 `TASKS` 中插入一条记录，具体步骤见
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

### 图像处理

现代手机拍摄的照片经 base64 编码后通常达到数 MB，云网关常在请求到达应用之前
就将其拒绝。因此上传图像会在浏览器内按固定阶梯缩放（自 1280 像素、质量 0.82 起，
逐级降至 640 像素、质量 0.55），直到满足 450 KB 的预算。压缩后仍超出限制的图像
会在界面中标记，而不会被静默发送。更小的图像也按比例消耗更少的视觉 token。

### 语言

界面、提示词与报告正文为英文。法规引用在英文对照旁保留中文原名，以便回到原始
法条核验。报告语言跟随提示词语言：将知识库替换为其它法域的法规，报告即以相应
语言生成。

## 快速开始

```bash
git clone https://github.com/YiweiOu/smartcity-vision-inspector.git
cd smartcity-vision-inspector
npm install
npm start            # 访问 http://localhost:3000
```

选择厂商，输入 API Key，选择场景，上传图片，开始分析。若 3000 端口被占用，
服务会自动递增端口号，上限为 3999。

> [!IMPORTANT]
> **API Key 仅保存在本地。** Key 存储于浏览器 `localStorage`，只发送至本服务，
> 由本服务转发给用户所选厂商。不写入磁盘，也不传输给任何其它方。

### Docker

```bash
docker build -t smartcity-vision-inspector .
docker run -d --name scvi -p 3000:3000 smartcity-vision-inspector
```

### 配置说明

| 配置项 | 位置 | 说明 |
|---|---|---|
| 厂商、模型、API Key | 页面面板 ① | 仅存储于 `localStorage` |
| Temperature | 页面面板 ① | 部分新版本模型仅接受数值 `1`，预设已给出安全默认值 |
| 视觉能力标记 | 页面面板 ②（高级模式） | 将模型标记为支持视觉后才会开放图片上传 |
| 知识库 | 页面面板 ③ | 按场景划分，支持 `txt`、`md`、`json`、`csv`、`pdf` |
| 场景提示词 | 页面面板 ④ | 每次运行可修改；默认值定义于 `server.js` 的 `TASKS` |

### 支持的厂商

| 厂商 | 接口地址 | 视觉模型示例 |
|---|---|---|
| GLM（智谱） | `open.bigmodel.cn/api/paas/v4` | `glm-4v-plus`、`glm-5.3-flash` |
| Kimi（Moonshot） | `api.moonshot.cn/v1` | `kimi-k3`、`moonshot-v1-8k-vision-preview` |
| 腾讯混元 | `tokenhub.tencentmaas.com/v1` | `hy-vision-2.0-instruct` |
| 阿里千问 | `dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-vl-max`、`qwen3-vl-flash` |
| DeepSeek | `api.deepseek.com` | `deepseek-v4-flash-vision-exp` |
| OpenAI 兼容 | 任意 `/v1` 端点 | `gpt-4o` 或私有网关 |

各厂商模型目录更新频繁。界面中的"获取模型列表"按钮始终反映当前配置的 Key
可访问的模型。

## 架构

```
┌─────────────────────────── 浏览器 ────────────────────────────┐
│  index.html + app.js   （无框架、无构建步骤）                  │
│  · 厂商 / 模型 / Key / 温度  （仅 localStorage）               │
│  · 场景提示词编辑 · 知识库管理                                 │
│  · 批量上传 → canvas 压缩 → 结果展示与导出                     │
└───────────────┬─────────────────────────────┬─────────────────┘
                │ POST /api/analyze           │ /api/knowledge/*
┌───────────────▼─────────────────────────────▼─────────────────┐
│  server.js (Express)                                          │
│                                                               │
│  ① 体积护栏              对超过 4 MB 的图像返回明确的 413       │
│  ② 阶段一                场景命名并给出 8-15 个关键词           │
│  ③ 检索                  分块 → 二元词/token 打分 → top-N      │
│  ④ 阶段二                角色设定 + 问题 + 条款 → 判定          │
│  ⑤ callLLM()             视觉大模型代理                        │
│        · readJSONResponse()   先以文本读取响应体               │
│        · 回退阶梯             temperature → 1 → 省略           │
│  ⑥ parseVerdict()        从回复中提取 JSON                     │
│  ⑦ computeRisk()         依据结构化严重程度计算风险等级         │
└───────────────┬───────────────────────────────────────────────┘
                ▼
   GLM-4V · Kimi · Qwen-VL · 混元 · DeepSeek · GPT-4o · 自定义
```

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 描述了各阶段的实现、数据模型，
以及设计中已考虑的故障模式。

## 实现说明

以下几点来自在真实厂商接口上长期运行的经验，并已体现在代码中：

- **上游响应先按文本读取，再进行 JSON 解析。** 网关对超体积或被拒绝的请求会返回
  HTML 页面（nginx `502`/`503`、WAF 拦截页）。对这类响应体直接调用
  `await resp.json()` 会抛出 `Unexpected token '<'`，掩盖真实原因。代理改为检查
  Content-Type，并报告状态码、重定向后的最终地址以及 HTML 页面标题。
- **健康检查必须校验响应体。** 早期版本接受任意 2xx 状态码，导致网关返回 200 与
  HTML 错误页时被判定为可达，而所有真实分析均失败。现在会校验响应体的结构。
- **参数回退有选择地应用。** 部分新版本模型拒绝较低的 temperature 取值。请求会
  先以 `temperature = 1` 重试，再尝试省略该参数；但鉴权、配额与内容审核类错误
  会立即失败。
- **风险等级来源于结构化数据。** 它由服务端依据解析出的 `severity` 字段计算。
  若模型在列出"疏散通道被堵塞"的同时宣称"没有问题"，结果仍会被判定为危险。
- **错误处理按生产代码对待。** `catch` 块不引用 `try` 作用域内的变量，进程注册
  了 `unhandledRejection` 与 `uncaughtException` 处理器，确保单次厂商异常响应
  不会导致整个服务退出。

## 项目结构

```
smartcity-vision-inspector/
├── server.js               Express 后端：大模型代理、检索、风险计算
├── public/                 单页前端，无框架、无构建步骤
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── data/                   运行时创建；knowledge.json 在此自动播种
├── samples/
│   ├── images/             6 张经隐私筛查的样例照片（3 个场景）
│   ├── outputs/            平台对每张照片的真实输出
│   ├── reproduce.py        重新生成输出：python samples/reproduce.py <port> <key> <model>
│   └── README.md           样例集的筛查方式与来源
├── docs/
│   ├── ARCHITECTURE.md     设计说明
│   └── screenshots/
├── Dockerfile
└── .github/workflows/      CI：语法检查、标识符扫描、启动冒烟测试
```

## 常见问题

**需要 GPU 吗？**
不需要。推理在厂商侧完成，本服务只是一个代理加知识库。普通笔记本即可运行。

**数据会被发送到哪里？**
图片从浏览器发送至本服务，再由本服务发送至用户配置的厂商。除此之外不向任何
第三方传输数据，API Key 也不会被持久化。

**能否使用其它法域的法规？**
可以。替换 `server.js` 中 `TASKS` 的提示词与 `seedScenes()` 的种子文档即可，
两者均为纯文本。报告语言跟随提示词语言。

**为什么样例中没有安防场景？**
手头可用的安防场景影像均包含可识别人脸，因此未纳入样例集。该场景档案本身
功能完整，只是未用真实照片演示。

## 路线图

- 界面语言切换（报告语言已跟随提示词语言）
- 在词面打分之外提供可选的 embedding 检索
- 长分析任务的流式输出
- 面向完整巡检任务的批量 CSV 导出
- 附带本地模型（llama.cpp 或 Ollama）的 Docker Compose 配置

## 参与贡献

欢迎提交 issue 与 pull request。新增场景档案时，请附上一张经隐私筛查的样例
图片，以及平台对该图片的实际输出。参见
[CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE) © [Yiwei Ou](https://github.com/YiweiOu)

## 图片来源

`samples/images/` 中的照片收集自公开可访问的网页，版权归原作
者所有，仅以降低分辨率的形式作为测试样例使用。来源与所做处理见
[`samples/README.md`](samples/README.md)。
