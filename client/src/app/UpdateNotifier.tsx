import { useEffect, useRef } from 'react';
import { useToast } from '../shared/ui';
import { hasPromptedUpdate, showUpdateReadyToast } from '../shared/updateToast';

const updatePollIntervalMs = 30 * 60 * 1000;

function UpdateNotifier() {
  const { showToast } = useToast();
  const checkingRef = useRef(false);

  useEffect(() => {
    let disposed = false;

    const checkUpdate = async () => {
      if (checkingRef.current) {
        return true;
      }
      checkingRef.current = true;
      try {
        const result = await window.yibiao?.checkUpdate();
        if (!result?.enabled) {
          return false;
        }
        if (disposed || !result.updateAvailable || !result.downloaded || !result.version) {
          return true;
        }
        if (hasPromptedUpdate(result.version)) {
          return true;
        }
        showUpdateReadyToast(showToast, result.version);
        return true;
      } catch {
        // 自动检查失败不打扰用户，手动检查入口会展示错误。
        return true;
      } finally {
        checkingRef.current = false;
      }
    };

    let timer: number | undefined;
    void checkUpdate().then((enabled) => {
      if (disposed || !enabled) {
        return;
      }
      timer = window.setInterval(() => {
        void checkUpdate();
      }, updatePollIntervalMs);
    });

    return () => {
      disposed = true;
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
    };
  }, [showToast]);

  return null;
}

export default UpdateNotifier;
