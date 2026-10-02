import type { TagTemplate } from "../utils/drawings";

type Props = {
  editing: boolean;
  title: string;
  color: string;
  templates: TagTemplate[];
  notice: string;
  onTitle: (title: string) => void;
  onColor: (color: string) => void;
  onSaveTemplate: () => void;
  onUseTemplate: (template: TagTemplate) => void;
  onDeleteTemplate: (id: string) => void;
  onCopy: () => void;
};

export default function TagEditor(props: Props) {
  const buttonClass = "rounded border border-ink-200 px-2 py-1 hover:bg-ink-100 disabled:opacity-40 dark:border-ink-700 dark:hover:bg-ink-800";
  return (
    <div className="tag-editor space-y-2 rounded-xl border border-ink-200 bg-white/80 p-3 text-xs dark:border-ink-700 dark:bg-ink-900" aria-label="矩形打标编辑器">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tag-editor-heading font-semibold">{props.editing ? "编辑选中标注" : "新矩形标注"}</span>
        <label className="tag-editor-title flex min-w-0 flex-1 items-center gap-2">
          标题
          <input aria-label="标注标题" value={props.title} maxLength={60} placeholder="例如：震荡整理、放量突破"
            className="min-w-24 flex-1 rounded border border-ink-200 bg-transparent px-2 py-1 dark:border-ink-700"
            onChange={event => props.onTitle(event.target.value)} />
        </label>
        <input type="color" aria-label="标注颜色" title="标注颜色" value={props.color}
          className="h-7 w-8 cursor-pointer rounded border border-ink-200 bg-transparent p-0.5"
          onChange={event => props.onColor(event.target.value)} />
        <button type="button" className={buttonClass} onClick={props.onSaveTemplate}>保存为模板</button>
        <button type="button" disabled={!props.editing} className={buttonClass} onClick={props.onCopy}>复制标注</button>
      </div>
      <div className="flex max-h-24 flex-wrap items-center gap-2 overflow-y-auto">
        <span className="text-ink-500 dark:text-mist-200">常用模板</span>
        {props.templates.length ? props.templates.map(template => (
          <span key={template.id} className="inline-flex overflow-hidden rounded border border-ink-200 dark:border-ink-700">
            <button type="button" aria-label={`使用模板：${template.title}`} title={`用“${template.title}”绘制新矩形`}
              className="inline-flex max-w-52 items-center gap-1 px-2 py-1" onClick={() => props.onUseTemplate(template)}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: template.color }} />
              <span className="truncate">{template.title}</span>
            </button>
            <button type="button" aria-label={`删除模板：${template.title}`} className="border-l border-ink-200 px-2 dark:border-ink-700"
              onClick={() => props.onDeleteTemplate(template.id)}>×</button>
          </span>
        )) : <span className="text-ink-500 dark:text-mist-200">保存标题与颜色后，点击模板即可重复框选。</span>}
        <span role="status" className="text-ink-500 dark:text-mist-200">{props.notice}</span>
      </div>
    </div>
  );
}
