# Miao ID Plugin

Repository: <https://github.com/STC214/Miao_ID_Plugin.git>

## 1. 功能简述

这个插件用于给 TRSS-Yunzai / Yunzai 管理米游社 App H5 请求所需的本地设备模型。

它要解决的问题是：在使用 `genshin` 插件执行类似 `#米游社更新面板` 的查询时，米游社接口可能反复返回验证码、`retcode: 1034` 或类似验证失败结果。经过实际验证，问题不一定是接口完全失效，而是机器人发出的请求环境和真实手机 App 的请求环境差异太大。

当前确认可用的模型是：

```text
旧 Game Record 接口
+ 米游社 App H5 请求头
+ 对应账号抓包成功时的 x-rpc-device_id
+ 对应账号抓包成功时的 x-rpc-device_fp
```

这个插件做的事情：

```text
1. 读取你自己从米游社 App 抓到的 HAR。
2. 从成功的 character/detail 请求里提取设备信息。
3. 合并写入 /root/Yunzai/config/config/mys-device.local.json。
4. 让 genshin 插件后续请求时使用这套真实设备模型。
```

它支持的导入来源：

```text
1. 容器内 HAR 文件路径。
2. http/https 下载链接。
3. QQ 私聊或临时对话窗口中上传的 har / zip / rar 文件。
4. zip / rar 压缩包内包含一个或多个 HAR。
5. 群聊中不接收、不处理 har / zip / rar，避免敏感 HAR 泄露。
```

它还会做一个轻量的验证码提示：

```text
当用户发送 #米游社更新面板 这类命令后，插件不会拦截原命令。
它只会延迟读取最近日志。
如果发现验证码、1034、429 或 GT 验证相关失败，再补一条简短帮助。
```

这个提示不会替代 `GT-Manual-Plugin`，也不会干扰你手动完成验证。原来的面板查询、GT 验证和其他插件流程仍然照常运行。

它内置了解压依赖：

```text
adm-zip        用于解压 zip
node-unrar-js  用于解压 rar
```

普通 `zip` / `rar` 不需要再在容器里额外安装 `unzip`、`7z`、`unar`。只有遇到特殊压缩包时，插件才会尝试调用系统解压工具作为兜底。

压缩包只有在成功提取出有效设备模型并写入配置后，才会自动删除原始压缩包。解压出来的 HAR 文件会保留；原本未压缩的裸 HAR 文件也会保留。
URL 导入带有 30 秒下载超时和 10MB 大小上限，避免异常链接拖慢机器人进程。

这个插件不会做这些事情：

```text
1. 不联网收集设备指纹。
2. 不生成批量假设备。
3. 不内置真实 cookie、token、device_id、device_fp。
4. 不绕过账号风控本身，只复用你自己设备上已经成功请求过的请求环境。
```

## 2. 使用详细方法

### 2.1 安装到 Yunzai 插件目录

进入机器人根目录，再把插件克隆到 `./plugins/Miao_ID_plugin`。这和安装其他 Yunzai 插件时常用的 `git clone ... ./plugins/插件目录` 写法一致。

TRSS-Yunzai 常见根目录：

```text
/root/Yunzai
```

Miao-Yunzai 常见根目录：

```text
/app/Miao-Yunzai
```

下面以 TRSS-Yunzai 的 `/root/Yunzai` 为例。

如果你用 Git 管理这个插件：

```bash
cd /root/Yunzai
git clone --depth=1 https://github.com/STC214/Miao_ID_Plugin.git ./plugins/Miao_ID_plugin
cd ./plugins/Miao_ID_plugin
pnpm install
```

如果是手动复制：

```bash
cd /root/Yunzai
cp -r Miao_ID_plugin /root/Yunzai/plugins/Miao_ID_plugin
cd /root/Yunzai/plugins/Miao_ID_plugin
pnpm install
```

如果容器里没有 `pnpm`，可以使用当前容器已有的包管理器：

```bash
npm install
```

安装完成后重启 Yunzai 容器：

```bash
docker restart trss-yunzai
```

### 2.2 确认插件是否加载

在 QQ 里发送：

```text
#米游社设备帮助
```

正常情况下会返回插件帮助信息。

可以继续发送：

```text
#米游社设备列表
```

如果还没有导入设备模型，会提示没有找到：

```text
/root/Yunzai/config/config/mys-device.local.json
```

这是正常的。

### 2.3 验证码提示

手动查看帮助：

```text
#米游社验证帮助
```

当你发送类似下面的命令时：

```text
#米游社更新面板
#米游社刷新面板
```

插件会做旁路观察：

```text
1. 不拦截原命令。
2. 不提前返回，不阻止 genshin 插件处理。
3. 不替代 GT-Manual-Plugin。
4. 延迟几秒读取最近日志。
5. 如果日志里出现验证码失败、1034、429 或 GT 验证相关失败，再补一条简短帮助。
```

自动提示内容大致是：

```text
检测到米游社查询触发验证码。
如果刚手动验证过仍失败，请导入一次你自己手机成功请求的 HAR：
#米游社设备导入
支持同消息/引用消息上传 har、zip、rar。导入后重启 trss-yunzai。
```

### 2.4 从 QQ 上传 HAR 导入

最方便的方式是直接在 QQ 私聊或临时对话窗口里上传抓包文件。群聊里不会接收或处理 HAR、ZIP、RAR。

支持这些文件：

```text
xxx.har
xxx.zip
xxx.rar
```

推荐操作：

```text
1. 在 QQ 私聊或临时对话窗口里把 har / zip / rar 文件发给机器人。
2. 引用这条文件消息。
3. 发送：#米游社设备导入
```

如果当前适配器能在消息事件里提供文件路径或下载链接，插件会自动读取这个文件，解压压缩包，并扫描里面的 HAR。只有成功导入有效设备模型后，原始压缩包才会自动删除；解压出来的 HAR 会长期保留。

如果导入成功，会返回类似：

```text
已导入 1 个设备模型。
UID ********* <- xxx.har#12
请重启 trss-yunzai 后生效。
```

这里的 `UID *********` 表示导入的是哪个游戏 UID。真实 UID 不建议写进公开文档。

导入后重启容器：

```bash
docker restart trss-yunzai
```

### 2.5 从容器内文件路径导入

如果 QQ 上传方式拿不到文件路径，可以先把 HAR 放进容器目录，例如：

```text
/root/Yunzai/temp/xxx.har
```

然后在 QQ 里发送：

```text
#米游社设备导入 /root/Yunzai/temp/xxx.har
```

压缩包也可以。导入成功后，原始压缩包会自动删除，解压出来的 HAR 会保留：

```text
#米游社设备导入 /root/Yunzai/temp/xxx.zip
#米游社设备导入 /root/Yunzai/temp/xxx.rar
```

### 2.6 从 URL 导入

如果你有一个临时下载链接，也可以直接导入：

```text
#米游社设备导入 https://example.com/xxx.har
```

URL 导入只适合小文件，插件最多下载 10MB。HAR 里通常含 cookie、token、设备指纹，不要上传到不可信网盘或长期公开链接。导入完成后，尽快删除临时文件或让链接过期。

下面这些服务都能临时存放文件并返回可复制的 URL。实际可用性、速度和规则可能变化，使用前以官网说明为准。

| 服务 | 适合用法 | 示例 |
| --- | --- | --- |
| tmpfiles.org | 可设置 60 秒到 48 小时过期，API 返回文件 URL。 | `curl -F "file=@xxx.har" -F "expire=3600" https://tmpfiles.org/api/v1/upload` |
| temp.sh | 简单临时上传，页面说明文件 3 天后过期。 | `curl -F "file=@xxx.har" https://temp.sh/upload` |
| file.io | 可设置过期和下载次数，返回结果里有 `link` 字段；适合一次性下载。 | `curl -F "file=@xxx.har" -F "maxDownloads=1" https://file.io` |

拿到返回 URL 后，再发送：

```text
#米游社设备导入 <返回的 URL>
```

### 2.7 命令行手动提取

也可以不用 QQ 命令，直接在插件目录运行脚本：

```bash
cd /root/Yunzai/plugins/Miao_ID_plugin
node scripts/extract-mys-device-from-har.mjs Reqable导出的文件.har mys-device.local.json
```

生成的结构类似：

```jsonc
{
  "*********": { // 这里填写游戏 UID，例如原神 UID
    "device_id": "********", // 这里填写抓包得到的 x-rpc-device_id
    "device_fp": "********", // 这里填写抓包得到的 x-rpc-device_fp
    "device_name": "********", // 这里填写抓包得到的 x-rpc-device_name
    "app_version": "********", // 这里填写抓包得到的 x-rpc-app_version
    "sys_version": "********", // 这里填写抓包得到的 x-rpc-sys_version
    "tool_verison": "********", // 这里填写抓包得到的 x-rpc-tool_verison
    "user_agent": "********" // 这里填写抓包得到的 User-Agent
  }
}
```

把生成文件放到 Yunzai 配置目录：

```bash
cp mys-device.local.json /root/Yunzai/config/config/mys-device.local.json
chmod 600 /root/Yunzai/config/config/mys-device.local.json
docker restart trss-yunzai
```

### 2.8 插件实际写入的位置

最终配置文件路径：

```text
/root/Yunzai/config/config/mys-device.local.json
```

这个文件按 UID 存储不同设备模型。后续导入新的 HAR 时，会合并更新，不会故意删除已有 UID。

### 2.9 推荐抓包内容

HAR 里最好包含一次成功的角色详情请求，也就是请求成功、响应里有角色数据的 `character/detail`。

插件会优先寻找：

```text
retcode = 0
character/detail
```

如果 HAR 里只有失败请求、验证码请求，或者没有角色详情接口，插件可能无法提取有效模型。

### 2.10 常见问题

如果发送 `#米游社设备帮助` 没反应：

```text
1. 确认插件目录在 /root/Yunzai/plugins/Miao_ID_plugin。
2. 确认已经运行 pnpm install 或 npm install。
3. 确认已经重启 trss-yunzai。
4. 查看 Yunzai 启动日志里有没有插件加载报错。
```

如果 QQ 上传文件后导入失败：

```text
1. 确认是在私聊或临时对话窗口操作，群聊或无法识别会话类型的事件都不会接收 har/zip/rar。
2. 当前适配器可能没有把文件路径或下载链接传给插件。
3. 换用容器内路径导入。
4. 或者把文件放到 /root/Yunzai/temp/ 后再导入。
```

如果导入成功但查询仍然弹验证码：

```text
1. 确认 HAR 来自同一个账号、同一个 UID 的成功请求。
2. 确认 /root/Yunzai/config/config/mys-device.local.json 已经更新。
3. 确认 genshin 插件已经读取这个本地配置。
4. 重启 trss-yunzai 后再试。
5. 如果还是失败，重新抓一次成功的 character/detail 请求。
```

## 3. 风险声明和开发者注意事项

### 3.1 敏感信息

HAR 文件通常可能包含：

```text
cookie
token
account_id
device_id
device_fp
User-Agent
```

这些都可能算敏感信息。不要把 HAR、真实 `mys-device.local.json`、真实设备指纹提交到公开仓库。

本项目 `.gitignore` 默认忽略：

```text
*.har
*.zip
*.rar
*.reqable
*.log
mys-device*.json
config/mys-device.local.json
```

但 `.gitignore` 不是保险箱。发布前仍然应该手动检查：

```bash
rg -n "ltoken|stoken|cookie|Cookie|device_fp|device_id|account_id|token" .
```

### 3.2 使用边界

这个插件的定位是保存和复用你自己设备上的请求环境，方便个人机器人稳定查询。

不建议用于：

```text
1. 批量账号。
2. 共享他人设备指纹。
3. 公开分发真实设备模型。
4. 频繁轮换伪造设备。
5. 绕过平台风控或高频请求限制。
```

如果平台接口、风控规则或插件实现发生变化，这个方法可能失效，需要重新分析请求模型。

### 3.3 代码结构

主要文件：

```text
index.js                                插件入口
apps/mys-device.js                      QQ 命令处理和验证码旁路提示
lib/har-parser.js                       从 HAR 提取设备模型
lib/device-store.js                     读写 mys-device.local.json
lib/import-source.js                    处理路径、URL、QQ 文件、zip、rar
lib/request-model.js                    请求头模型辅助函数
lib/verification-watch.js               查询后延迟检查验证码日志
scripts/extract-mys-device-from-har.mjs 命令行提取脚本
templates/mys-device.local.example.json 脱敏配置模板
```

开发时建议先跑：

```bash
npm run check
```

这个命令只做语法检查，不会联网，也不会读取真实 HAR。

### 3.4 许可和责任

这个项目是个人环境辅助工具。使用前请确认你理解 HAR 和设备指纹的敏感性，并自行承担账号、数据和平台规则相关风险。

如果要公开发布，建议保持示例全部脱敏，只保留 `********` 占位和必要注释。
