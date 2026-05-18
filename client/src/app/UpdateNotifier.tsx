import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import { dismissRemoteNotice, fetchRemoteNotice, hasDismissedRemoteNotice, type RemoteNotice } from '../shared/remoteNotice';
import { MarkdownRenderer, useToast } from '../shared/ui';
import { hasPromptedUpdate, showUpdateReadyToast } from '../shared/updateToast';

const updatePollIntervalMs = 30 * 60 * 1000;

function UpdateNotifier() {
  const { showToast } = useToast();
  const updateCheckingRef = useRef(false);
  const noticeCheckingRef = useRef(false);
  const activeNoticeIdRef = useRef('');
  const [remoteNotice, setRemoteNotice] = useState<RemoteNotice | null>(null);

  const closeRemoteNotice = () => {
    if (remoteNotice?.id) {
      dismissRemoteNotice(remoteNotice.id);
    }
    activeNoticeIdRef.current = '';
    setRemoteNotice(null);
  };

  useEffect(() => {
    let disposed = false;

    const checkUpdate = async () => {
      if (updateCheckingRef.current) {
        return;
      }
      updateCheckingRef.current = true;
      try {
        const result = await window.yibiao?.checkUpdate();
        if (!result?.enabled) {
          return;
        }
        if (disposed || !result.updateAvailable || !result.downloaded || !result.version) {
          return;
        }
        if (hasPromptedUpdate(result.version)) {
          return;
        }
        showUpdateReadyToast(showToast, result.version);
      } catch {
        // 自动检查失败不打扰用户，手动检查入口会展示错误。
      } finally {
        updateCheckingRef.current = false;
      }
    };

    const checkRemoteNotice = async () => {
      if (noticeCheckingRef.current) {
        return;
      }
      noticeCheckingRef.current = true;
      try {
        const notice = await fetchRemoteNotice();
        if (disposed || !notice || hasDismissedRemoteNotice(notice.id)) {
          return;
        }
        if (activeNoticeIdRef.current === notice.id) {
          return;
        }

        activeNoticeIdRef.current = notice.id;
        setRemoteNotice(notice);
      } catch {
        // 公告检查失败不打扰用户。
      } finally {
        noticeCheckingRef.current = false;
      }
    };

    const checkAll = () => {
      void checkUpdate();
      void checkRemoteNotice();
    };

    let timer: number | undefined;
    checkAll();
    if (!disposed) {
      timer = window.setInterval(() => {
        checkAll();
      }, updatePollIntervalMs);
    }

    return () => {
      disposed = true;
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
    };
  }, [showToast]);

  return (
    <Dialog.Root open={Boolean(remoteNotice)} onOpenChange={(open) => !open && closeRemoteNotice()}>
      <Dialog.Portal>
        <Dialog.Overlay className="remote-notice-modal" />
        <Dialog.Content className="remote-notice-card">
          <div className="remote-notice-header">
            <div>
              <Dialog.Title>{remoteNotice?.title || '公告'}</Dialog.Title>
              <Dialog.Description>来自项目维护者的远程公告。</Dialog.Description>
            </div>
            <button className="remote-notice-close" type="button" aria-label="关闭公告" onClick={closeRemoteNotice}>×</button>
          </div>
          {remoteNotice?.updatedAt ? <div className="remote-notice-meta">更新时间：{remoteNotice.updatedAt}</div> : null}
          <div className="markdown-viewer remote-notice-content">
            <MarkdownRenderer allowRawHtml={false}>{remoteNotice?.content || ''}</MarkdownRenderer>
          </div>
          <div className="remote-notice-actions">
            <button className="primary-action" type="button" onClick={closeRemoteNotice}>知道了</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default UpdateNotifier;
