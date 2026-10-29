import { SDK_CATEGORIES, categoryRank } from '../shared/categories';
import type { SdkCategory } from '../shared/categories';

export { SDK_CATEGORIES, categoryRank };
export type { SdkCategory };

export interface SdkMeta {
  name: string;
  category: string;
  description: string;
  /** Preferred display order inside its category. */
  weight?: number;
}

function meta(name: string, category: SdkCategory, description: string): SdkMeta {
  return { name, category, description };
}

export const SDK_META: Record<string, SdkMeta> = {
  // ---- 语言运行时 ----
  node: meta('Node.js', '语言运行时', 'JavaScript 服务端运行时，附带 npm'),
  deno: meta('Deno', '语言运行时', '基于 V8 的安全运行时'),
  bun: meta('Bun', '语言运行时', '一体化 JS/TS 运行时与包管理器'),
  python: meta('Python', '语言运行时', '官方解释器（当前元数据仅提供 Conda 安装包）'),
  pypy: meta('PyPy', '语言运行时', '高性能 Python JIT 实现'),
  rust: meta('Rust', '语言运行时', 'rustc 与 cargo 工具链'),
  rustup: meta('rustup', '语言运行时', 'Rust 官方工具链管理器'),
  go: meta('Go', '语言运行时', 'Go 官方工具链，含标准库'),
  goplus: meta('Go+', '语言运行时', '面向工程与数据的 Go 衍生语言'),
  zig: meta('Zig', '语言运行时', '现代系统编程语言与 C 工具链'),
  v: meta('V', '语言运行时', '简洁快速的编译型语言'),
  'v-analyzer': meta('V Analyzer', '语言运行时', 'V 语言的 LSP 实现'),
  nim: meta('Nim', '语言运行时', '静态类型、Python 风格语法的编译型语言'),
  crystal: meta('Crystal', '语言运行时', 'Ruby 语法的编译型语言'),
  dlang: meta('D', '语言运行时', '系统级编译型语言（dmd）'),
  odin: meta('Odin', '语言运行时', '面向数据的系统编程语言'),
  moonbit: meta('MoonBit', '语言运行时', '面向云与边缘的 AI 原生语言'),
  julia: meta('Julia', '语言运行时', '科学计算语言'),
  r: meta('R', '语言运行时', '统计计算与绘图语言'),
  ruby: meta('Ruby', '语言运行时', '动态脚本语言，含 gem'),
  perl: meta('Perl', '语言运行时', '经典文本处理语言'),
  php: meta('PHP', '语言运行时', 'Web 开发语言解释器'),
  lua: meta('Lua', '语言运行时', '轻量嵌入式脚本语言'),
  elixir: meta('Elixir', '语言运行时', '基于 BEAM 的函数式语言'),
  erlang: meta('Erlang', '语言运行时', '高并发容错运行时'),
  gleam: meta('Gleam', '语言运行时', '面向 BEAM 的类型安全语言'),
  clojure: meta('Clojure', '语言运行时', 'JVM 上的 Lisp 方言'),
  scala: meta('Scala', '语言运行时', 'JVM 函数式与面向对象语言'),
  kotlin: meta('Kotlin', '语言运行时', 'JVM/Android 官方推荐语言'),
  groovy: meta('Groovy', '语言运行时', 'JVM 上的动态语言'),
  codon: meta('Codon', '语言运行时', '高性能 Python 编译器'),

  // ---- JVM 生态 ----
  jdk: meta('JDK', 'JVM 生态', '多种发行版 JDK（Temurin/Zulu/Liberica 等）'),
  gradle: meta('Gradle', 'JVM 生态', 'JVM 构建工具'),
  maven: meta('Maven', 'JVM 生态', 'Java 项目构建与依赖管理'),
  coursier: meta('Coursier', 'JVM 生态', 'Scala/JVM 依赖启动器'),

  // ---- C/C++ 与构建 ----
  gcc: meta('GCC', 'C/C++ 与构建', 'GNU C 编译器'),
  gxx: meta('G++', 'C/C++ 与构建', 'GNU C++ 编译器'),
  'g++': meta('G++', 'C/C++ 与构建', 'GNU C++ 编译器'),
  clang: meta('Clang', 'C/C++ 与构建', 'LLVM C/C++/ObjC 编译器'),
  'llvm-mingw': meta('LLVM-MinGW', 'C/C++ 与构建', 'Windows 上的 LLVM + MinGW 工具链'),
  mingw: meta('MinGW', 'C/C++ 与构建', 'GNU Windows 工具链'),
  msys2: meta('MSYS2', 'C/C++ 与构建', 'Windows 上的 POSIX 兼容环境'),
  cygwin: meta('Cygwin', 'C/C++ 与构建', 'Windows 上的类 Unix 运行环境'),
  cmake: meta('CMake', 'C/C++ 与构建', '跨平台构建系统'),
  ninja: meta('Ninja', 'C/C++ 与构建', '高速构建工具'),
  bazel: meta('Bazel', 'C/C++ 与构建', 'Google 多语言构建系统'),
  'thrift-compiler': meta('Thrift Compiler', 'C/C++ 与构建', 'Thrift IDL 编译器'),
  protoc: meta('protoc', 'C/C++ 与构建', 'Protocol Buffers 编译器'),
  upx: meta('UPX', 'C/C++ 与构建', '可执行文件压缩工具'),

  // ---- 数据库 ----
  mysql: meta('MySQL', '数据库', '关系型数据库服务端'),
  postgresql: meta('PostgreSQL', '数据库', '开源对象关系型数据库'),
  mongodb: meta('MongoDB', '数据库', '文档型数据库'),
  redka: meta('Redka', '数据库', '基于 SQLite 的 Redis 兼容存储'),

  // ---- 命令行工具 ----
  fd: meta('fd', '命令行工具', '更快的 find 替代品'),
  fzf: meta('fzf', '命令行工具', '模糊查找器'),
  ripgrep: meta('ripgrep', '命令行工具', '极速文本搜索'),
  lazygit: meta('lazygit', '命令行工具', 'Git 终端界面'),
  lazydocker: meta('lazydocker', '命令行工具', 'Docker 终端界面'),
  'github-cli': meta('GitHub CLI', '命令行工具', 'gh 命令行客户端'),
  'git-win': meta('Git for Windows', '命令行工具', 'Windows 版 Git'),
  kubectl: meta('kubectl', '命令行工具', 'Kubernetes 命令行客户端'),
  gsudo: meta('gsudo', '命令行工具', 'Windows 上的 sudo 替代品'),
  vhs: meta('VHS', '命令行工具', '终端操作录制为 GIF'),
  served: meta('served', '命令行工具', '本地静态文件服务'),
  acast: meta('acast', '命令行工具', '终端录制工具'),
  agg: meta('agg', '命令行工具', 'asciinema 录制转 GIF'),
  garnet: meta('Garnet', '命令行工具', '微软高速缓存存储'),
  wasmer: meta('Wasmer', '命令行工具', 'WebAssembly 运行时'),
  wasmedge: meta('WasmEdge', '命令行工具', '轻量 WebAssembly 运行时'),
  wasmtime: meta('Wasmtime', '命令行工具', 'Bytecode Alliance WASM 运行时'),
  miniconda: meta('Miniconda', '命令行工具', '精简版 Conda 发行包'),

  // ---- 编辑器与文档 ----
  neovim: meta('Neovim', '编辑器与文档', '现代化 Vim 编辑器'),
  vscode: meta('VS Code', '编辑器与文档', '微软代码编辑器'),
  zls: meta('ZLS', '编辑器与文档', 'Zig 语言服务器'),
  tinymist: meta('Tinymist', '编辑器与文档', 'Typst 语言服务'),
  typst: meta('Typst', '编辑器与文档', '现代排版系统'),
  'typst-lsp': meta('Typst LSP', '编辑器与文档', 'Typst 语言服务器（旧版）'),
  'typst-preview': meta('Typst Preview', '编辑器与文档', 'Typst 实时预览工具'),
  'tree-sitter': meta('tree-sitter', '编辑器与文档', '增量语法解析器 CLI'),
  ffmpeg: meta('FFmpeg', '编辑器与文档', '音视频处理工具集'),
  flutter: meta('Flutter', '编辑器与文档', '跨平台 UI 框架与 SDK'),
  dotnet: meta('.NET SDK', '编辑器与文档', '微软 .NET 开发工具链'),
};

export function sdkMeta(id: string): SdkMeta {
  return (
    SDK_META[id] ?? {
      name: id.replace(/[-_]/g, ' '),
      category: '其他',
      description: '第三方工具，暂无中文说明',
    }
  );
}

export function displayName(id: string): string {
  return sdkMeta(id).name;
}

export function categoryOf(id: string): string {
  return sdkMeta(id).category;
}
