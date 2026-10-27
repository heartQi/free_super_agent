<script setup lang="ts">
import { Setting, VideoPlay } from '@element-plus/icons-vue'
import { useMoarkAccount } from '@/composables/useMoarkAccount'
import { useOneClickCompose } from '@/composables/useOneClickCompose'
import ConfigCenterModal from '@/components/ConfigCenterModal.vue'

const { isReady, openConfigCenter } = useMoarkAccount()
const { isComposing, runOneClick } = useOneClickCompose()
const reserveWindowControls = navigator.userAgent.includes('Windows')
</script>

<template>
  <header class="app-header" :class="{ 'has-window-controls': reserveWindowControls }">
    <div class="project-brand" aria-label="超级IP智能体">
      <span class="brand-mark">IP</span>
      <div class="project-name">超级IP智能体</div>
    </div>

    <div class="header-actions">
      <button
        class="one-click-button"
        type="button"
        :disabled="isComposing"
        @click="runOneClick"
      >
        <VideoPlay class="config-center-icon" aria-hidden="true" />
        <span>{{ isComposing ? '合成中…' : '一键合成' }}</span>
      </button>
      <button
        class="config-center-button"
        :class="{ 'is-ready': isReady }"
        type="button"
        title="登录"
        @click="openConfigCenter"
      >
        <Setting class="config-center-icon" aria-hidden="true" />
        <span>登录</span>
        <span class="config-center-dot" :class="{ ok: isReady }"></span>
      </button>
    </div>

    <ConfigCenterModal />
  </header>
</template>

<style scoped>
.app-header {
  position: relative;
  height: 75px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 20px;
  border-top: 1px solid #ffffff;
  border-bottom: 1px solid #cfd9e6;
  background: #f4f7fb;
  box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.72), 0 2px 8px rgba(20, 32, 48, 0.05);
  -webkit-app-region: drag;
}

.app-header.has-window-controls {
  padding-right: 156px;
}

.project-brand {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 14px;
}

.brand-mark {
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 14px;
  color: #ffffff;
  background: #1f4b99;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0;
}

.project-name {
  min-width: 0;
  color: #121924;
  font-size: 28px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  -webkit-app-region: no-drag;
}

.one-click-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid #1f4b99;
  border-radius: 999px;
  color: #ffffff;
  background: #1f4b99;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(31, 75, 153, 0.18);
}

.one-click-button:hover {
  background: #183d7a;
}

.config-center-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid #c7d5e7;
  border-radius: 999px;
  color: #29435f;
  background: linear-gradient(180deg, #ffffff 0%, #eef5fb 100%);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(42, 74, 108, 0.08);
}

.config-center-button:hover {
  border-color: #1f4b99;
  color: #1f4b99;
}

.config-center-button.is-ready {
  border-color: #86d0a9;
  color: #2f7d55;
}

.config-center-icon {
  width: 16px;
  height: 16px;
}

.config-center-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #e6a23c;
}

.config-center-dot.ok {
  background: #2f9e63;
}

@media (max-width: 640px) {
  .app-header {
    padding: 0 12px;
  }

  .brand-mark {
    width: 40px;
    height: 40px;
    font-size: 16px;
  }

  .project-name {
    font-size: 22px;
  }
}
</style>
