import { ElMessage } from "element-plus";
import { ref } from "vue";
import { useLipSyncDedicated } from "@/composables/lip-sync-dedicated/useLipSyncDedicated";
import { useLipSyncRuntime } from "@/composables/lip-sync-runtime/useLipSyncRuntime";
import { useCopyCreation } from "@/composables/useCopyCreation";
import { useDouyinExtraction } from "@/composables/useDouyinExtraction";
import { useMoarkAccount } from "@/composables/useMoarkAccount";
import { useSubtitleRecognition } from "@/composables/useSubtitleRecognition";
import { useVoiceCloneMoark } from "@/composables/voice-clone-moark/useVoiceCloneMoark";

let exportAll: (() => Promise<boolean>) | null = null;

export function registerOneClickExport(fn: (() => Promise<boolean>) | null): void {
  exportAll = fn;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitUntil(ready: () => boolean, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (ready()) return true;
    await wait(200);
  }
  return ready();
}

const isComposing = ref(false);

export function useOneClickCompose() {
  const { ensureReady } = useMoarkAccount();
  const douyin = useDouyinExtraction();
  const copy = useCopyCreation();
  const voice = useVoiceCloneMoark();
  const lipSync = useLipSyncRuntime();
  const dedicated = useLipSyncDedicated();
  const subtitle = useSubtitleRecognition();

  function stop(step: string): void {
    ElMessage.warning(`一键合成停在${step}`);
  }

  async function runOneClick(): Promise<void> {
    if (isComposing.value) return;
    if (!ensureReady()) return;

    if (!douyin.douyinUrl.value.trim()) {
      stop("第一步：请先填写抖音地址");
      return;
    }

    await voice.refreshVoices();
    if (!voice.selectedVoice.value) {
      stop("第三步：请先选择音色");
      return;
    }

    await dedicated.refreshConfig();
    if (!dedicated.config.baseUrl.trim()) {
      stop("第四步：请先填写独享算力服务器地址");
      return;
    }

    if (lipSync.videoStatus.value !== "已上传") {
      stop("第四步：请先上传对口型视频");
      return;
    }

    isComposing.value = true;
    try {
      await douyin.extractDouyinCopy();
      if (!douyin.extractedCopy.value.trim()) {
        stop("第一步：文案没有提取出来");
        return;
      }

      await copy.createRewriteCopy(douyin.extractedCopy.value);
      if (!copy.createdCopy.value.trim()) {
        stop("第二步：文案没有改写出来");
        return;
      }

      const previousAudio = lipSync.uploadedAudioPreviewUrl.value;
      await voice.synthesizeSelectedVoice();
      if (!voice.synthesizedAudioUrl.value.trim()) {
        stop("第三步：语音没有合成出来");
        return;
      }

      const audioReady = await waitUntil(
        () =>
          Boolean(lipSync.uploadedAudioPreviewUrl.value) &&
          lipSync.uploadedAudioPreviewUrl.value !== previousAudio,
        8000,
      );
      if (!audioReady) {
        stop("第三步：语音还没有同步到对口型");
        return;
      }

      await lipSync.submitTask(voice.synthesizedAudioUrl.value);
      if (!lipSync.resultVideoUrl.value.trim()) {
        stop("第四步：对口型视频没有生成");
        return;
      }

      await subtitle.startSubtitleRecognition();
      if (subtitle.subtitleTaskStatus.value === "识别失败" || subtitle.subtitleTaskStatus.value === "已中断") {
        stop("第五步：字幕没有识别出来");
        return;
      }
      if (!subtitle.subtitleSrt.value.trim() && subtitle.subtitleList.value.length === 0) {
        stop("第五步：字幕没有识别出来");
        return;
      }

      if (!exportAll) {
        stop("第七步：导出还没准备好");
        return;
      }
      const exported = await exportAll();
      if (!exported) {
        stop("第七步：导出没有完成");
        return;
      }

      ElMessage.success("一键合成完成");
    } finally {
      isComposing.value = false;
    }
  }

  return { isComposing, runOneClick };
}
