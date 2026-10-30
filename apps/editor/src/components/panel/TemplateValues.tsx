import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  canvasTemplateValues,
  setPropDefault,
  valuesByName,
  type DcDoc,
} from "@dc/core";
import { newUndoGroup } from "../../editEngine";
import { display, edit, useCanvas, useStore } from "../../store";
import { focusBoard } from "../canvas/view";
import { Chevron } from "../icons";
import { Segmented } from "../Segmented";
import { Tweaks, TweakControl, TweakField } from "./OtherProps";

/** Past this many values the section grows a filter. */
const FILTER_FROM = 30;
/** With more values than this the groups start folded, so the section stays a list of artboards. */
const OPEN_UP_TO = 12;

/** The template values of the whole canvas, rebuilt only when sources change. */
function useCanvasValues() {
  const canvas = useCanvas();
  const files = useStore((s) => s.files);
  const drafts = useStore((s) => s.drafts);
  return useMemo(
    () => canvasTemplateValues(canvas, (f) => display(useStore.getState(), f)),
    [canvas, files, drafts],
  );
}

/** Select an artboard, show its Tweaks and bring it into view. */
function showBoard(file: string) {
  useStore.setState({
    selection: { kind: "board", file },
    panelTab: "tweaks",
    menu: null,
  });
  focusBoard(file);
}

/**
 * The Tweaks of the selected artboard, then the way to the rest: the other
 * artboards' values are in the nothing-selected panel, so say so and go there.
 */
export function TweaksTab({ file, doc }: { file: string; doc: DcDoc }) {
  const { t } = useTranslation();
  const groups = useCanvasValues();
  const others = groups
    .filter((g) => g.file !== file)
    .reduce((n, g) => n + g.values.length, 0);
  const showAll = () => {
    useStore.setState({ selection: null, menu: null });
    requestAnimationFrame(() =>
      document
        .querySelector(".panel .tvals")
        ?.scrollIntoView({ block: "start", behavior: "smooth" }),
    );
  };
  return (
    <>
      <Tweaks file={file} doc={doc} />
      {others > 0 && (
        <div className="sec">
          <button className="btn ghost sm tvall" onClick={showAll}>
            {t("panel.templateValues.seeAll", { count: others })}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * What every artboard of the canvas exposes through `data-props`, edited with
 * the Tweaks fields (same write-back): by artboard, or by name when several
 * artboards share one, with a Set all that is one undo step. For the panel's
 * nothing-selected state; `.design/canvas-template-values.md`.
 */
export function TemplateValues() {
  const { t } = useTranslation();
  const groups = useCanvasValues();
  const total = groups.reduce((n, g) => n + g.values.length, 0);
  const shared = useMemo(
    () => valuesByName(groups).filter((n) => n.entries.length > 1),
    [groups],
  );
  const [view, setView] = useState<"board" | "name">("board");
  const byName = view === "name" && shared.length > 0;
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const query = total > FILTER_FROM ? q.trim().toLowerCase() : "";
  const isFolded = (key: string) =>
    query ? false : (folded[key] ?? total > OPEN_UP_TO);
  const fold = (key: string) =>
    setFolded({ ...folded, [key]: !isFolded(key) });

  const boards = groups
    .map((g) => ({
      ...g,
      values: query
        ? g.values.filter(([k]) => k.toLowerCase().includes(query))
        : g.values,
    }))
    .filter((g) => g.values.length);
  const names = valuesByName(groups).filter(
    (n) => !query || n.name.toLowerCase().includes(query),
  );

  const head = (key: string, title: string, count: number, onName: () => void, nameTitle: string) => {
    const closed = isFolded(key);
    return (
      <div className="tvhead">
        <button
          className="ib sm"
          aria-expanded={!closed}
          aria-label={t(
            closed
              ? "panel.templateValues.unfold"
              : "panel.templateValues.fold",
            { name: title },
          )}
          onClick={() => fold(key)}
        >
          <Chevron open={!closed} />
        </button>
        <button className="tvname" title={nameTitle} onClick={onName}>
          {title}
        </button>
        <span className="faint">
          {t(
            byName
              ? "panel.templateValues.boards"
              : "panel.templateValues.count",
            { count },
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="sec tvals">
      <h3>{t("panel.templateValues.title")}</h3>
      {total === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          {t("panel.templateValues.empty")}
        </p>
      ) : (
        <>
          {shared.length > 0 && (
            <Segmented
              value={view}
              onChange={setView}
              label={t("panel.templateValues.view")}
              options={[
                { value: "board", label: t("panel.templateValues.byBoard") },
                { value: "name", label: t("panel.templateValues.byName") },
              ]}
            />
          )}
          {total > FILTER_FROM && (
            <input
              className="inp"
              type="search"
              value={q}
              placeholder={t("panel.templateValues.filterPlaceholder")}
              aria-label={t("panel.templateValues.filter")}
              onChange={(e) => setQ(e.currentTarget.value)}
            />
          )}
          {query && !(byName ? names : boards).length && (
            <p className="hint" style={{ margin: 0 }}>
              {t("panel.templateValues.none", { q })}
            </p>
          )}
          {byName
            ? names.map((n) => {
                const key = JSON.stringify([n.name, n.entries[0].spec.editor, n.entries[0].spec.options]);
                const first = n.entries[0].spec;
                const same = n.entries.every(
                  (e) => JSON.stringify(e.spec.default) === JSON.stringify(first.default),
                );
                const many = n.entries.length > 1;
                const setAll = (v: unknown) => {
                  const group = newUndoGroup();
                  for (const e of n.entries)
                    edit(e.file, (src) => setPropDefault(src, n.name, v).source, {
                      actor: "human",
                      summary: `tweak ${n.name} → ${JSON.stringify(v)}`,
                      group,
                    });
                };
                return (
                  <div key={key} className="tvgroup" role="group" aria-label={n.name}>
                    {head(key, n.name, n.entries.length, () => fold(key), t("panel.templateValues.foldName", { name: n.name }))}
                    {!isFolded(key) && (
                      <>
                        {many && (
                          <div className="tvall-row">
                            <TweakControl
                              name={n.name}
                              label={t("panel.templateValues.setAll")}
                              spec={first}
                              value={first.default}
                              onSet={setAll}
                            />
                            {!same && (
                              <span className="hint">{t("panel.templateValues.differ")}</span>
                            )}
                          </div>
                        )}
                        {n.entries.map((e) => (
                          <TweakControl
                            key={e.file}
                            name={n.name}
                            label={e.title}
                            spec={e.spec}
                            value={e.spec.default}
                            onSet={(v) =>
                              edit(e.file, (src) => setPropDefault(src, n.name, v).source, {
                                actor: "human",
                                summary: `tweak ${n.name} → ${JSON.stringify(v)}`,
                              })
                            }
                          />
                        ))}
                      </>
                    )}
                  </div>
                );
              })
            : boards.map((g) => (
                <div key={g.file} className="tvgroup" role="group" aria-label={g.title}>
                  {head(g.file, g.title, g.values.length, () => showBoard(g.file), t("panel.templateValues.show", { name: g.title }))}
                  {!isFolded(g.file) &&
                    g.values.map(([k, s]) => (
                      <TweakField key={k} file={g.file} name={k} spec={s} />
                    ))}
                </div>
              ))}
        </>
      )}
    </div>
  );
}
