import DocumentAnalysisPage from './DocumentAnalysisPage';
import OutlineEditPage from './OutlineEditPage';
import ContentEditPage from './ContentEditPage';
import { useTechnicalPlanWorkflow } from '../hooks/useTechnicalPlanWorkflow';
import { FloatingToolbar, ToolbarArrowLeftIcon, ToolbarArrowRightIcon } from '../../../shared/ui';
import type { TechnicalPlanStep } from '../types';

const steps: TechnicalPlanStep[] = [
  'document-analysis',
  'outline-edit',
  'content-edit',
  'expand',
];

const stepLabels: Record<TechnicalPlanStep, string> = {
  'document-analysis': '标书解析',
  'outline-edit': '目录编辑',
  'content-edit': '生成正文',
  expand: '扩写',
};

const resetState = {
  step: 'document-analysis' as TechnicalPlanStep,
  fileName: '',
  fileContent: '',
  projectOverview: '',
  techRequirements: '',
  outlineData: null,
};

function TechnicalPlanHome() {
  const { state, setState } = useTechnicalPlanWorkflow();
  const activeIndex = steps.indexOf(state.step);

  const switchStep = (step: TechnicalPlanStep) => {
    setState((prev) => ({ ...prev, step }));
  };

  const goToOffset = (offset: number) => {
    const nextStep = steps[activeIndex + offset];
    if (nextStep) {
      switchStep(nextStep);
    }
  };

  const toolbarGroups = [
    {
      id: 'technical-plan-reset',
      actions: [
        {
          id: 'reset',
          label: '重置',
          variant: 'danger' as const,
          tooltip: '清空当前技术方案流程',
          onClick: () => setState(resetState),
        },
        {
          id: 'home',
          label: '首页',
          variant: state.step === 'document-analysis' ? 'primary' as const : 'secondary' as const,
          tooltip: '回到标书解析',
          onClick: () => switchStep('document-analysis'),
        },
      ],
    },
    {
      id: 'technical-plan-navigation',
      actions: [
        {
          id: 'previous-step',
          label: '上一步',
          icon: <ToolbarArrowLeftIcon />,
          disabled: activeIndex <= 0,
          tooltip: activeIndex <= 0 ? '当前已经是第一步' : `返回${stepLabels[steps[activeIndex - 1]]}`,
          onClick: () => goToOffset(-1),
        },
        {
          id: 'next-step',
          label: '下一步',
          icon: <ToolbarArrowRightIcon />,
          variant: 'primary' as const,
          disabled: activeIndex >= steps.length - 1,
          tooltip: activeIndex >= steps.length - 1 ? '当前已经是最后一步' : `进入${stepLabels[steps[activeIndex + 1]]}`,
          onClick: () => goToOffset(1),
        },
      ],
    },
  ];

  return (
    <div className="page-stack technical-workbench">
      {state.step === 'document-analysis' && (
        <DocumentAnalysisPage
          fileName={state.fileName}
          fileContent={state.fileContent}
          onFileImported={(fileName, fileContent) => setState((prev) => ({
            ...prev,
            fileName,
            fileContent,
            projectOverview: '',
            techRequirements: '',
          }))}
          onNext={() => switchStep('outline-edit')}
        />
      )}

      {state.step === 'outline-edit' && <OutlineEditPage />}
      {state.step === 'content-edit' && <ContentEditPage />}
      {state.step === 'expand' && (
        <section className="empty-panel compact-placeholder">
          <span className="section-kicker">STEP 04</span>
          <h3>扩写</h3>
          <p>后续接入旧方案导入、章节扩写和人工校准。</p>
        </section>
      )}

      <FloatingToolbar groups={toolbarGroups} label="技术方案工具条" />
    </div>
  );
}

export default TechnicalPlanHome;
