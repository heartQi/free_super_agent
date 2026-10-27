/**
 * 本机对口型容器的启动与释放。
 *
 * wupeiqi/duix 启动后会把模型留在显存里，任务结束也不会自己卸掉。
 * 地址是本机时：提交前确保容器已启动，任务结束、失败或取消后 docker stop，
 * 把显存让出来。下次再提交时再 docker start。
 * 地址不是本机时什么都不做，远端容器停不了。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logInfo } from "../_shared/logger";

const execFileAsync = promisify(execFile);

const LOG_TAG = "lipsync-dedicated";
const CONTAINER_NAME = "duix-gen-video";
const READY_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;

export function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname;
    return (
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
}

async function docker(args: string[], timeoutMs: number): Promise<string> {
  const { stdout } = await execFileAsync("docker", args, {
    windowsHide: true,
    timeout: timeoutMs,
  });
  return stdout.trim();
}

async function listContainerNames(filters: string[]): Promise<string[]> {
  const stdout = await docker(
    ["ps", "-a", ...filters, "--format", "{{.Names}}"],
    15_000,
  );
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function findContainerName(port: string): Promise<string | null> {
  const named = await listContainerNames([
    "--filter",
    `name=^${CONTAINER_NAME}$`,
  ]);
  if (named.includes(CONTAINER_NAME)) return CONTAINER_NAME;

  const byImage = await listContainerNames([
    "--filter",
    "ancestor=wupeiqi/duix",
  ]);
  if (byImage[0]) return byImage[0];

  const byPort = await listContainerNames(["--filter", `publish=${port}`]);
  return byPort[0] ?? null;
}

async function isServiceUp(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/query?code=ping`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("已取消"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("已取消"));
      },
      { once: true },
    );
  });
}

/**
 * 本机服务没在听端口时，启动容器并等到接口可访问。
 * 模型在容器启动过程中加载，端口打开就表示可以提交任务。
 */
export async function ensureLocalLipSyncReady(
  baseUrl: string,
  onStatus?: (status: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!isLoopbackBaseUrl(baseUrl)) return;
  if (await isServiceUp(baseUrl)) return;

  onStatus?.("正在启动对口型服务...");
  const port = new URL(baseUrl).port || "80";
  let name: string | null;
  try {
    name = await findContainerName(port);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    logInfo(LOG_TAG, `查找对口型容器失败: ${message}`);
    throw new Error("找不到 docker 命令，无法启动本机对口型服务");
  }
  if (!name) {
    throw new Error(
      "没有找到本机对口型容器 duix-gen-video，请先按说明创建并启动",
    );
  }

  try {
    await docker(["start", name], 60_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    logInfo(LOG_TAG, `启动容器 ${name} 失败: ${message}`);
    throw new Error("本机对口型容器启动失败");
  }

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isServiceUp(baseUrl)) {
      logInfo(LOG_TAG, `对口型服务已就绪: ${name}`);
      return;
    }
    await delay(POLL_INTERVAL_MS, signal);
  }
  throw new Error("对口型服务启动超时，模型还没加载完成");
}

/**
 * 停掉本机容器，释放显存。容器本来就没在跑、或 docker 不可用时只记日志。
 * 返回是否执行了停止。
 */
export async function releaseLocalLipSync(baseUrl: string): Promise<boolean> {
  if (!isLoopbackBaseUrl(baseUrl)) return false;

  try {
    const port = new URL(baseUrl).port || "80";
    const name = await findContainerName(port);
    if (!name) return false;
    const running = await docker(
      ["inspect", "-f", "{{.State.Running}}", name],
      15_000,
    );
    if (running !== "true") return false;
    logInfo(LOG_TAG, `停止容器 ${name}，释放显存`);
    await docker(["stop", "-t", "10", name], 30_000);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    logInfo(LOG_TAG, `释放显存失败: ${message}`);
    return false;
  }
}
