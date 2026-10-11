import { attr, getStyle, rootElement, slideIdOf, TRANSITIONS } from '@dc/core';
import { deckOf, display, editElement, parsed, slidesOf, useDeck, useSlides, useStore } from '../../store';
import { addSlide, deleteSlide, duplicateSlide, isSkipped, removeSection, renameDeck, setCover, startSection, toggleSkip, describeSection } from '../../deck';
import { exportBoard } from '../Board';
import { ColorField, Field, Row, Select } from './fields';

const TRANSITION_LABEL: Record<string, string> = { none: '无', fade: '淡出', push: '推出', magic: '神奇移动' };

/** The slide itself (nothing on it selected): its look, how it leaves, its place in the outline. */
export function SlideProps({ file }: { file: string }) {
  const id = slideIdOf(file)!;
  const source = useStore((s) => display(s, file));
  const deck = useDeck();
  const ids = useSlides();
  const doc = source ? parsed(source) : null;
  const root = doc ? rootElement(doc) : undefined;
  if (!root) return <div className="empty">这张幻灯片读不出来：文件里应该只有一个 &lt;section&gt;。</div>;
  const style = attr(root, 'style') ?? '';
  const bg = getStyle(style, 'background') ?? getStyle(style, 'background-color') ?? '';
  const solid = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-z]+)$/i.test(bg.trim());
  const transition = attr(root, 'data-transition') ?? 'none';
  const skipped = isSkipped(source);
  const section = Object.entries(deck.sections).find(([, s]) => s.start === id);
  const set = (prop: string, value: string | null) => editElement(file, [{ kind: 'style', tid: root.tid, prop, value }]);
  return (
    <>
      <div className="sec">
        <h3>
          幻灯片 {ids.indexOf(id) + 1} / {ids.length}
        </h3>
        <Row label="背景">
          {solid || !bg ? (
            <ColorField value={bg} onCommit={(v) => set('background', v || null)} label="背景色" allowNone={false} />
          ) : (
            <Field value={bg} numeric={false} onCommit={(v) => set('background', v || null)} label="背景" />
          )}
        </Row>
        <Row label="文字色">
          <ColorField value={getStyle(style, 'color') ?? ''} onCommit={(v) => set('color', v || null)} label="文字颜色" />
        </Row>
        <Row label="字体">
          <Field value={getStyle(style, 'font-family') ?? ''} numeric={false} onCommit={(v) => set('font-family', v.trim() || null)} label="字体" />
        </Row>
        <Row label="切换" title="演示时这张幻灯片怎样离开">
          <Select
            value={transition}
            options={TRANSITIONS.map((t) => ({ value: t, label: TRANSITION_LABEL[t] }))}
            onChange={(v) => editElement(file, [{ kind: 'attr', tid: root.tid, name: 'data-transition', value: v === 'none' ? null : v }])}
            label="切换效果"
          />
        </Row>
        <label className="check">
          <input type="checkbox" checked={skipped} onChange={() => toggleSkip(id)} />
          演示时跳过
        </label>
        <label className="check">
          <input type="checkbox" checked={deck.cover === id} disabled={deck.cover === id} onChange={() => setCover(id)} />
          作为封面（缩略图）
        </label>
      </div>
      <div className="sec">
        <h3>章节</h3>
        {section ? (
          <>
            <Row label="描述">
              <Field value={section[1].description} numeric={false} onCommit={(v) => describeSection(section[0], v)} label="章节描述" placeholder="一句话描述这一章" />
            </Row>
            <button className="btn" onClick={() => removeSection(section[0])}>
              移除章节（幻灯片保留）
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => startSection(id)}>
            从这张开始新章节
          </button>
        )}
      </div>
      <div className="sec">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => addSlide(id)}>
            新幻灯片
          </button>
          <button className="btn" onClick={() => duplicateSlide(id)}>
            复制
          </button>
          <button className="btn" onClick={() => void exportBoard(file, 'png2')}>
            导出 PNG
          </button>
          <button className="btn danger" disabled={ids.length <= 1} onClick={() => void deleteSlide(id)}>
            删除
          </button>
        </div>
        <span className="hint">
          文件 {file}；id 是 <code>{id}</code>。
        </span>
      </div>
    </>
  );
}

/** Nothing selected in a deck. */
export function DeckProps() {
  const deck = useDeck();
  const n = useStore((s) => slidesOf(s).length);
  const faces = Object.values(deckOf(useStore.getState()).faces).map((f) => f.family);
  return (
    <div className="sec">
      <div className="empty" style={{ textAlign: 'center', padding: '8px 0 4px' }}>
        <div style={{ color: 'var(--ink)', fontWeight: 500 }}>未选中任何内容</div>
        点击幻灯片上的任意元素，在这里编辑。
      </div>
      <h3>演示文稿</h3>
      <Row label="名称">
        <Field value={deck.title} numeric={false} onCommit={renameDeck} label="演示文稿名称" />
      </Row>
      <p className="hint" style={{ margin: 0 }}>
        {n} 张幻灯片 · {Object.keys(deck.sections).length} 个章节{faces.length ? ` · 字体 ${faces.join('、')}` : ''}
      </p>
      <p className="hint" style={{ margin: 0 }}>
        双击文字直接改；拖动已选中的元素调整顺序，拖出父容器变成自由定位。左侧缩略图可以拖动排序，右键有更多操作。
      </p>
      <p className="hint" style={{ margin: 0 }}>
        ↑ ↓ 切换幻灯片 · ⌘D 复制 · ⌘↵ 演示 · Esc 取消选中 · ⇧↵ 选中上一级 · ↵ 选中下一级 · ⇧1 适应
      </p>
    </div>
  );
}
