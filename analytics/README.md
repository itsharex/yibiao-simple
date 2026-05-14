# 埋点统计部署手册

本目录维护通用匿名埋点统计服务，采用 `Cloudflare Workers + Analytics Engine + Cloudflare Pages`。

公开仓库中只保存 Worker 和 Pages 源码，不保存 `ADMIN_TOKEN`、`ANALYTICS_API_TOKEN` 等密钥。

## 一、简短使用说明

服务地址：

| 项目 | 地址 |
| --- | --- |
| API 地址 | `https://analytics.agnet.top` |
| 统计页面地址 | `https://static.analytics.agnet.top` |

核心接口：

| 接口 | 用途 | 鉴权 |
| --- | --- | --- |
| `GET /health` | 检查 Worker 是否正常 | 不需要 |
| `POST /track` | 客户端上报埋点事件 | 不需要 |
| `GET /api/projects` | 读取允许统计的项目列表 | `Authorization: Bearer ADMIN_TOKEN` |
| `GET /api/summary` | 读取每日统计、页面排行、版本分布 | `Authorization: Bearer ADMIN_TOKEN` |
| `GET /api/latest` | 读取最近事件 | `Authorization: Bearer ADMIN_TOKEN` |

当前事件约定：

| event | 说明 | page 是否必填 |
| --- | --- | --- |
| `app_open` | 应用打开 | 否 |
| `page_view` | 页面访问 | 是 |

Analytics Engine 字段映射：

| 字段 | 含义 |
| --- | --- |
| `blob1` | `projectName` |
| `blob2` | `event` |
| `blob3` | `page` |
| `blob4` | `version` |
| `blob5` | `platform` |
| `blob6` | `arch` |
| `blob7` | `client_id` |
| `index1` | `projectName` |
| `double1` | 固定写入 `1` |

客户端上报示例：

```powershell
Invoke-RestMethod `
  -Uri "https://analytics.agnet.top/track" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"projectName":"yibiao-client","event":"app_open","version":"0.1.0","platform":"win32","arch":"x64","client_id":"test-client"}'
```

统计页面使用方式：

1. 打开 `https://static.analytics.agnet.top`。
2. API 地址填写 `https://analytics.agnet.top`。
3. 输入 Cloudflare Worker Secret 中配置的 `ADMIN_TOKEN`。
4. 点击“刷新”。
5. 选择项目和时间范围查看每日打开量、页面访问量、页面排行、版本分布和最近事件。

注意事项：

1. `ADMIN_TOKEN` 仅保存在 Cloudflare Worker Secret 和个人浏览器 localStorage，不写入仓库。
2. Analytics Engine 数据保留期为 3 个月。
3. Analytics Engine 数据写入后可能需要等待几十秒才可查询。
4. 高流量场景可能采样，查询必须使用 `SUM(_sample_interval)` 统计。
5. 埋点只做匿名统计，不采集文档内容、文件名、本地路径、API Key 或用户输入。
6. 中国大陆访问 Cloudflare 可能偶发失败，客户端埋点必须异步静默失败，不能影响主流程。

## 二、初次部署操作流程

### 1. 目录结构

当前源码结构：

```text
analytics/
  README.md
  worker/
    package.json
    wrangler.jsonc
    src/
      index.js
  dashboard/
    index.html
```

### 2. 启用 Analytics Engine

1. 登录 Cloudflare Dashboard。
2. 左侧进入 `存储和数据库`。
3. 点击 `Analytics Engine`。
4. 点击 `Enable`。
5. 不需要手动创建 Dataset，Worker 第一次写入后会自动创建 `agnet_analytics`。

### 3. 创建 Cloudflare API Token

Worker 的查询接口需要通过 Cloudflare SQL API 查询 Analytics Engine，因此需要一个只读 Token。

1. 点击 Cloudflare 右上角头像。
2. 进入 `My Profile`。
3. 打开 `API Tokens`。
4. 点击 `Create Token`。
5. 选择 `Create Custom Token`。
6. Token 名称填写 `analytics-engine-read`。
7. 权限选择 `Account -> Account Analytics -> Read`。
8. Account Resources 选择当前 Cloudflare 账号。
9. 创建后复制 Token。
10. Token 只放到 Worker Secret `ANALYTICS_API_TOKEN`，不要写入仓库。

### 4. 通过 GitHub 部署 Worker

1. 进入 Cloudflare `Workers & Pages`。
2. 点击 `Create`。
3. 选择 `Worker`。
4. 选择连接 GitHub 仓库。
5. Repository 选择当前开源仓库。
6. Root directory 填写 `analytics/worker`。
7. Build command 如需填写，使用 `npm install`。
8. Deploy command 如需填写，使用 `npm run deploy`。
9. 如果 Cloudflare 页面只有一个命令输入框，可填写 `npm run deploy`。
10. 部署后 Worker 名称应为 `agnet-analytics-api`，由 `analytics/worker/wrangler.jsonc` 指定。

如果更习惯先手动创建 Worker，也可以先创建 `agnet-analytics-api`，再在该 Worker 的 `Settings -> Builds` 中连接 GitHub 仓库，并把 Root directory 设置为 `analytics/worker`。

### 5. 配置 Worker 变量、密钥和绑定

进入 Worker `agnet-analytics-api` 的 `Settings -> Variables and Secrets`。

普通变量：

| 变量名 | 示例值 | 说明 |
| --- | --- | --- |
| `ALLOWED_PROJECTS` | `yibiao-client` | 允许上报的项目名，多个项目用英文逗号分隔 |
| `ACCOUNT_ID` | Cloudflare Account ID | 用于调用 Analytics Engine SQL API |

Secret：

| 变量名 | 说明 |
| --- | --- |
| `ADMIN_TOKEN` | 统计页面查询接口鉴权 Token |
| `ANALYTICS_API_TOKEN` | `Account Analytics Read` 权限的 Cloudflare API Token |

确认 Worker 绑定：

| Binding | 类型 | Dataset |
| --- | --- | --- |
| `ANALYTICS` | Analytics Engine | `agnet_analytics` |

`ANALYTICS` 绑定已写在 `analytics/worker/wrangler.jsonc` 中。若 Cloudflare UI 没有自动识别，可在 Worker 的 `Settings -> Bindings` 中手动添加同名绑定。

### 6. 绑定 Worker 自定义域名

前提：`agnet.top` 已经托管在 Cloudflare DNS。

1. 进入 Worker `agnet-analytics-api`。
2. 打开 `Settings`。
3. 进入 `Domains & Routes`。
4. 点击 `Add`。
5. 选择 `Custom domain`。
6. 填写 `analytics.agnet.top`。
7. 保存并等待证书生效。
8. 打开 `https://analytics.agnet.top/health` 验证。

正常返回：

```json
{"code":0,"ok":true}
```

### 7. 测试 Worker 上报和查询

测试上报：

```powershell
Invoke-RestMethod `
  -Uri "https://analytics.agnet.top/track" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"projectName":"yibiao-client","event":"app_open","version":"0.1.0","platform":"win32","arch":"x64","client_id":"test-client"}'
```

测试查询，把 `<ADMIN_TOKEN>` 替换为 Worker Secret 中的真实值：

```powershell
Invoke-RestMethod `
  -Uri "https://analytics.agnet.top/api/summary?projectName=yibiao-client&days=30" `
  -Method Get `
  -Headers @{ Authorization = "Bearer <ADMIN_TOKEN>" }
```

如果刚写入后查询为空，等待几十秒再查。

### 8. 通过 GitHub 部署 Cloudflare Pages

1. 进入 Cloudflare `Workers & Pages`。
2. 点击 `Create`。
3. 选择 `Pages`。
4. 选择连接 GitHub 仓库。
5. Repository 选择当前开源仓库。
6. Project name 填写 `agnet-analytics-dashboard`。
7. Root directory 填写 `analytics/dashboard`。
8. Framework preset 选择 `None`。
9. Build command 留空。
10. Build output directory 填写 `.`。
11. 点击部署。

### 9. 绑定 Pages 自定义域名

1. 进入 Pages 项目 `agnet-analytics-dashboard`。
2. 打开 `Custom domains`。
3. 点击 `Set up a custom domain`。
4. 填写 `static.analytics.agnet.top`。
5. 保存并等待证书生效。
6. 打开 `https://static.analytics.agnet.top` 验证页面。

### 10. 验证统计页面

1. 打开 `https://static.analytics.agnet.top`。
2. API 地址保持 `https://analytics.agnet.top`。
3. 输入 Worker Secret 中配置的 `ADMIN_TOKEN`。
4. 点击“刷新”。
5. 如果提示 `unauthorized`，检查 Worker Secret 的 `ADMIN_TOKEN`。
6. 如果提示 `invalid projectName`，检查 Worker 变量 `ALLOWED_PROJECTS`。
7. 如果没有数据，先调用 `/track` 写入测试数据，然后等待几十秒。

## 三、添加其他统计的操作流程

### 1. 添加新项目

假设新项目名为 `my-other-app`。

1. 进入 Worker `agnet-analytics-api`。
2. 打开 `Settings -> Variables and Secrets`。
3. 找到普通变量 `ALLOWED_PROJECTS`。
4. 把值从 `yibiao-client` 改为 `yibiao-client,my-other-app`。
5. 保存并重新部署 Worker。
6. 打开 `https://static.analytics.agnet.top`，刷新后项目下拉框应出现 `my-other-app`。

项目名规则：

1. 只使用英文字母、数字、点、下划线、中划线。
2. 长度不要超过 80 个字符。
3. 不要使用中文、空格或引号。

### 2. 新项目接入上报

新项目统一请求：

```text
POST https://analytics.agnet.top/track
```

应用打开时上报：

```json
{
  "projectName": "my-other-app",
  "event": "app_open",
  "version": "1.0.0",
  "platform": "win32",
  "arch": "x64",
  "client_id": "anonymous-client-id"
}
```

页面访问时上报：

```json
{
  "projectName": "my-other-app",
  "event": "page_view",
  "page": "settings",
  "version": "1.0.0",
  "platform": "win32",
  "arch": "x64",
  "client_id": "anonymous-client-id"
}
```

前端封装示例：

```ts
const ANALYTICS_ENDPOINT = 'https://analytics.agnet.top/track';
const PROJECT_NAME = 'my-other-app';

export async function track(event: 'app_open' | 'page_view', data: Record<string, string> = {}) {
  try {
    const enabled = localStorage.getItem('telemetry_enabled') !== 'false';
    if (!enabled) return;

    await fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectName: PROJECT_NAME,
        event,
        page: data.page || '',
        version: data.version || '',
        platform: data.platform || '',
        arch: data.arch || '',
        client_id: getOrCreateAnonymousClientId(),
      }),
    });
  } catch {
    // 埋点失败不能影响业务。
  }
}

function getOrCreateAnonymousClientId() {
  const key = 'analytics_client_id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}
```

### 3. 添加新页面统计

如果只是统计新页面，不需要改 Worker。

在页面打开或路由切换时上报：

```ts
track('page_view', {
  page: 'new-page-name',
  version: appVersion,
  platform: window.yibiao?.platform || '',
  arch: 'x64',
});
```

页面名称建议：

1. 使用稳定英文短名，例如 `settings`、`knowledge-base`、`dashboard`。
2. 不要使用中文页面标题，避免后续统计口径变化。
3. 不要把用户输入、文件名、路径拼进 `page`。

### 4. 添加新事件类型

如果要新增 `export_word`、`ai_generate` 这类事件，需要改 Worker。

1. 修改 `analytics/worker/src/index.js`：

```js
const ALLOWED_EVENTS = new Set(['app_open', 'page_view', 'export_word', 'ai_generate']);
```

2. 提交代码后，Cloudflare Worker 会从 GitHub 自动部署。
3. 如果新事件不需要 `page`，保留当前校验即可。
4. 如果看板要单独展示新事件，需要修改 `/api/summary` 的 SQL 和 `analytics/dashboard/index.html` 渲染逻辑。
5. 如果只是记录在最近事件里，不改看板也能在 `/api/latest` 看到。

### 5. 添加更多字段

Analytics Engine 当前还有可用的 `blob8` 到 `blob20`，但字段顺序必须保持稳定。

建议只有确实需要时再加字段，例如：

| 字段 | 建议用途 |
| --- | --- |
| `blob8` | `channel`，下载渠道或发布渠道 |
| `blob9` | `locale`，语言环境 |
| `blob10` | `os_version`，系统版本 |

添加字段时需要同步修改：

1. 客户端上报 body。
2. Worker `writeDataPoint` 的 `blobs` 顺序。
3. Worker 查询 SQL。
4. Pages 看板渲染逻辑。

### 6. 验证新项目数据

上报测试数据：

```powershell
Invoke-RestMethod `
  -Uri "https://analytics.agnet.top/track" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"projectName":"my-other-app","event":"page_view","page":"home","version":"1.0.0","platform":"win32","arch":"x64","client_id":"test-client"}'
```

查询测试数据：

```powershell
Invoke-RestMethod `
  -Uri "https://analytics.agnet.top/api/summary?projectName=my-other-app&days=30" `
  -Method Get `
  -Headers @{ Authorization = "Bearer <ADMIN_TOKEN>" }
```

看板验证：

1. 打开 `https://static.analytics.agnet.top`。
2. 点击“刷新”。
3. 选择 `my-other-app`。
4. 查看每日统计和最近事件。

### 7. 排查问题

| 问题 | 原因 | 处理 |
| --- | --- | --- |
| `unauthorized` | ADMIN_TOKEN 错误 | 检查统计页面输入和 Worker Secret |
| `invalid projectName` | 项目名不在 `ALLOWED_PROJECTS` 或格式不合法 | 追加合法项目名并重新部署 Worker |
| `invalid event` | event 不在 `ALLOWED_EVENTS` | 使用现有事件或修改 Worker 白名单 |
| `missing page` | `page_view` 没传 page | 给页面访问事件补 `page` |
| 查询为空 | 数据未写入或还没同步 | 先测试 `/track`，等待几十秒再查 |
| CORS 报错 | Worker 未正确处理 `OPTIONS` | 检查 Worker 的 `corsHeaders` 和 `OPTIONS` 分支 |
