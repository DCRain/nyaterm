---
sidebar_position: 0
---

# 会话类型

NyaTerm 不只是 SSH 客户端，而是一个把多类终端、远程桌面与对象存储工作流放到同一工作区中的桌面应用。当前支持九类会话：

- **SSH**
- **本地终端**
- **Telnet**
- **串口**
- **S3**
- **FTP**
- **WebDAV**
- **RDP**
- **VNC**

理解它们之间的差异，有助于你判断某个功能为什么“只在某些标签页里出现”。

## 一览对比

| 会话类型 | 典型场景 | 支持的增强能力 |
|----------|----------|----------------|
| SSH | Linux / Unix 服务器远程运维 | SFTP、OTP、资源 / GPU / 进程 / Docker 监控、代理、跳板机、隧道、算法偏好 |
| 本地终端 | 本地 shell、脚本调试、构建命令 | 共享同一套终端 UI、命令历史、分屏 |
| Telnet | 旧设备、实验环境、兼容性排障 | 终端工作区能力，支持 `Backspace Mode`，但不包含 SSH 专属特性 |
| 串口 | 路由器、交换机、板卡、嵌入式调试口 | 串口参数配置、`Backspace Mode` 与终端工作区能力 |
| S3 | 对象存储浏览与跨后端拷贝 | 双栏文件工作区、与本地 / SFTP / FTP / WebDAV 互拷；无隐藏文件开关 |
| FTP | FTP / FTPS 文件站点 | 双栏文件工作区、TLS（FTPS）、隐藏文件过滤、跨后端拷贝 |
| WebDAV | NAS / Nextcloud 等 WebDAV 网盘 | 双栏文件工作区、与本地 / SFTP / S3 / FTP 互拷；无隐藏文件开关 |
| RDP | Windows 远程桌面、图形化运维入口 | 内嵌远程桌面画面、NLA/CredSSP、证书验证、代理 / SSH 跳板机、文本剪贴板、窗口适配与重连；也可按平台启动外部 RDP 客户端 |
| VNC | 裸 TCP VNC 服务、虚拟机控制台、轻量图形远程桌面 | 内嵌 Raw / ZRLE / Tight / Tight JPEG 显示、None / VNC Auth、代理 / SSH 跳板机、窗口适配、文本剪贴板与重连；也可启动外部 VNC 客户端 |

## SSH

SSH 是当前能力最完整的会话类型，适合：

- 登录远程 Linux / Unix 主机
- 浏览和传输远程文件
- 使用 OTP、跳板机、代理
- 查看远程资源、GPU、进程与 Docker 监控
- 配置端口隧道
- 精细控制 SSH 协商算法

如果你需要：

- 文件浏览器
- 自动上传 / 回传
- 远程资源监控
- 网络面板中的 SSH 隧道

那么应该优先使用 SSH。

## 本地终端

本地终端适合把本机 shell 工作流也放进 NyaTerm 工作区中，例如：

- 本地构建前端 / Rust 项目
- 跑脚本、日志查看、Git 命令
- 和远程 SSH 会话并排对照

它支持的重点不在远程功能，而在“和 SSH 会话共享同一套工作区体验”：

- 标签页
- 分屏
- 终端搜索
- 命令历史与建议
- 行号 / 时间戳 / 高亮等终端增强项

创建本地终端时，还可以指定：

- shell 路径，例如 `powershell.exe`、`cmd.exe`、`bash`、`wsl.exe`
- 工作目录

## Telnet

Telnet 会话适合：

- 旧设备维护
- 实验室环境
- 需要兼容非 SSH 登录链路的场景

它保留的是 NyaTerm 的终端工作区能力，但不会附带 SSH 特有的安全和文件能力。因此通常不会有：

- SFTP 文件浏览器
- OTP 绑定
- SSH 跳板机
- SSH 资源监控

如果你的目标只是“快速打开一个传统远程终端”，Telnet 会更直接。

对于依赖退格键兼容性的设备，Telnet 会话还提供 `Backspace Mode`，可以在 `Ctrl+H (BS)` 和 `DEL (0x7F)` 之间切换。

## 串口

串口会话适合连接：

- 网络设备控制台口
- 路由器 / 交换机
- 开发板、嵌入式设备、调试口

创建串口会话时可以配置：

- 串口号
- 波特率
- 数据位
- 校验位
- 停止位
- `Backspace Mode`

串口会话同样可以放进 NyaTerm 的标签页与分屏工作区中，适合边看一个串口输出，边在另一个 SSH 或本地终端里执行命令。

## S3

S3 会话适合浏览兼容 S3 的对象存储（含阿里云 OSS 等），以双栏文件工作区打开：一侧通常是本机或其它已连接的文件来源，另一侧是存储桶前缀。支持跨后端拷贝，但对象存储没有 POSIX 隐藏文件语义，因此不提供隐藏文件开关。终端 CWD 自动同步也不会作用于 S3 窗格。

创建 S3 会话时通常需要：

- Endpoint、Region、Bucket
- Access Key / Secret、可选 Session Token
- 可选根路径前缀与虚拟主机风格（部分厂商会自动启用）

## FTP

FTP 会话适合传统 FTP / 显式 FTPS 站点，同样使用双栏文件工作区，并支持隐藏文件过滤以及与本地、SFTP、S3、WebDAV 之间的拷贝。

创建 FTP 会话时通常需要：

- 主机、端口、用户名、密码
- 根路径
- 是否启用 TLS（FTPS）

## WebDAV

WebDAV 会话适合 NAS、Nextcloud 等 WebDAV 网盘。工作区形态与 S3 类似：双栏浏览与跨后端拷贝，但不提供隐藏文件开关，也不跟随终端 CWD。

创建 WebDAV 会话时通常需要：

- Endpoint
- 可选根路径、用户名与密码

## RDP

RDP 会话适合连接 Windows 主机或提供 RDP 服务的远程桌面环境。它和终端会话共享同一套标签页、分屏和保存连接体系，但底层是图形远程桌面，而不是文本终端。

创建 RDP 会话时可以配置：

- 主机、端口、用户名、密码和域
- 是否启用网络级身份验证（NLA / CredSSP）
- 证书策略：未知证书时询问、严格拒绝或仅本次接受
- 网络：已保存代理或 SSH 跳板机
- 显示模式：适应窗口或固定尺寸
- 文本剪贴板模式
- 自动重连次数

首次连接未知证书的 RDP 主机时，NyaTerm 会显示证书验证对话框。你可以只接受本次连接，也可以接受并记住该证书；如果已保存的证书后续发生变化，连接前会再次提示。

RDP 目前不提供终端命令历史、SFTP 文件浏览器或远程资源监控。如果你需要命令行增强能力，应优先使用 SSH、本地终端、Telnet 或串口会话。

### 外部 RDP 客户端

部分连接配置也可按平台探测可用客户端并启动外部程序（如 `mstsc`、FreeRDP）；密码由外部客户端自行提示输入。

**推荐客户端**

- Windows：系统自带的 `mstsc`，其次 FreeRDP（`xfreerdp` / `wfreerdp`）
- macOS：临时 `.rdp` 文件 + `open`（由 Microsoft Remote Desktop 等接管），其次 FreeRDP
- Linux：`xfreerdp` / `wlfreerdp` / `freerdp`，或 Remmina

若未检测到可用客户端，NyaTerm 会弹出安装提示，并给出平台相关的安装命令或下载页。

## VNC

VNC 会话适合连接提供传统 RFB / VNC 服务的虚拟机控制台、实验环境或轻量图形桌面。它和 RDP 一样使用远程桌面 pane，并共享保存连接、最近使用、标签页和分屏工作区。

创建 VNC 会话时可以配置：

- 主机和端口
- 安全模式：自动、None 或 classic VNC Authentication
- 网络：已保存代理或 SSH 跳板机
- 显示模式：适应窗口、实际尺寸或拉伸
- 文本剪贴板开关
- 自动重连次数
- shared / view-only 行为

VNC 协议层没有 TLS / VeNCrypt 支持，但底层 TCP 连接可以通过已保存 SOCKS5 / HTTP / ProxyCommand 代理或 SSH 跳板机建立。classic VNC Authentication 的密码限制为 8 字节以内，NyaTerm 会拒绝超长密码而不会截断。画面编码默认按 `DesktopSizePseudo`、ZRLE、Tight、Raw 顺序声明；Tight JPEG 会在后端解码成统一 RGBA framebuffer，Raw 仍保留为稳定 fallback。暂不支持 CopyRect、cursor pseudo-encoding 和远程 resize。文本剪贴板限定为 Latin-1 文本，避免把二进制或超大内容塞进 VNC 协议路径。

### VNC 互通矩阵

| 场景 | 安全模式 | 编码 | 状态 |
| --- | --- | --- | --- |
| Scripted RFB 3.8 fixture | None | ZRLE / Tight / Tight JPEG -> RGBA RawImage | 已通过自动测试 |
| Scripted RFB 3.8 fixture | classic VNC Auth | ZRLE / Tight / Tight JPEG -> RGBA RawImage | 已通过自动测试 |
| TigerVNC | None / VNC Auth | Raw / ZRLE / Tight / JPEG | 真实服务器待测 |
| TightVNC | None / VNC Auth | Raw / Tight / JPEG | 真实服务器待测 |
| x11vnc / LibVNCServer | None / VNC Auth | Raw / ZRLE / Tight / JPEG | 真实服务器待测 |
| QEMU / KVM VNC | None / VNC Auth | Raw / ZRLE / Tight / JPEG | 真实服务器待测 |

### 外部 VNC 客户端

部分连接配置也可按平台探测可用客户端并启动外部程序；密码由外部客户端自行提示输入。

**推荐客户端**

- macOS：内置 `open vnc://host:port`（屏幕共享），其次 TigerVNC Viewer / `vncviewer`
- Windows：TigerVNC / UltraVNC / TightVNC / RealVNC 等 `vncviewer`
- Linux：`vncviewer` / `xtigervncviewer`，或 Remmina

若未检测到可用客户端，NyaTerm 会弹出安装提示，并给出平台相关的安装命令或下载页。

## 如何选择？

可以按下面这个简单规则判断：

- 要远程服务器完整能力：用 **SSH**
- 要本机 shell：用 **本地终端**
- 要兼容传统远程终端：用 **Telnet**
- 要接调试口 / 设备串口：用 **串口**
- 要对象存储文件浏览：用 **S3**
- 要 FTP / FTPS 站点：用 **FTP**
- 要 NAS / WebDAV 网盘：用 **WebDAV**
- 要 Windows 图形远程桌面：用 **RDP**
- 要 VNC / 虚拟机控制台图形桌面：用 **VNC**

## 在一个工作区里混用

NyaTerm 的优势之一，是允许你把这些类型混合放进同一工作区，例如：

- 左边 SSH 看远端日志
- 右边本地终端执行打包脚本
- 再开一个串口标签观察设备启动信息
- 再开 S3 / FTP / WebDAV 双栏工作区做跨后端拷贝
- 另一个分屏中打开 RDP 查看 Windows 远程桌面状态
- 再开一个 VNC pane 操作虚拟机控制台

这也是为什么文档里很多功能会写成“某会话类型专属”或“某会话类型才显示”的原因——工作区统一，但能力边界仍然取决于底层会话类型。
