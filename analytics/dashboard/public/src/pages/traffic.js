import { assertReady, getEncodedProjectAndDays, loadProjectOptions, requestJson, saveSettings } from '../api.js';
import { renderTable } from '../render.js';
import { state } from '../state.js';

const pageLabels = {
  'technical-plan': '技术方案',
  'technical-plan/document-analysis': '技术方案 - 上传招标文件',
  'technical-plan/bid-analysis': '技术方案 - 招标文件解析',
  'technical-plan/outline-generation': '技术方案 - 目录生成',
  'technical-plan/content-edit': '技术方案 - 生成正文',
  'technical-plan/expand': '技术方案 - 扩写改写',
  'business-bid': '商务标',
  'knowledge-base': '知识库',
  'duplicate-check': '标书查重',
  'rejection-check': '废标项检查',
  'bid-opportunity': '投标机会',
  'developer-test': '测试页',
  settings: '设置',
};

function getPageLabel(page) {
  return pageLabels[page] || '未知页面';
}

export async function loadTraffic() {
  assertReady();
  await loadProjectOptions();
  saveSettings();

  const { projectName, days } = getEncodedProjectAndDays();
  const summary = await requestJson(`/api/summary?projectName=${projectName}&days=${days}`);
  const pages = (summary.pages || []).map((row) => ({
    ...row,
    pageLabel: getPageLabel(row.page),
  }));

  renderTable(state.pagesTable, pages, [
    { key: 'pageLabel', label: '功能名称' },
    { key: 'page', label: '路由', code: true },
    { key: 'count', label: '访问量' },
  ], '暂无页面访问数据');

  renderTable(state.versionsTable, summary.versions || [], [
    { key: 'version', label: '版本', code: true },
    { key: 'clients', label: '活跃客户端数' },
    { key: 'todayClients', label: '今日活跃客户端' },
    { key: 'count', label: '事件数' },
  ], '暂无版本数据');
}
