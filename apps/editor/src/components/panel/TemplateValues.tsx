import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { canvasTemplateValues } from "@dc/core";
import { display, useCanvas, useStore } from "../../store";
import { focusBoard } from "../canvas/view";
import { Chevron } from "../icons";
import { TweakField } from "./OtherProps";

/** Past this many values the section grows a filter. */
const FILTER_FROM = 30;
/** With more values than this the groups start folded, so the section stays a list of artboards. */
const OPEN_UP_TO = 12;

/**
 * What every artboard of the canvas exposes through `data-props`, grouped by
 * artboard, edited with the Tweaks fields (same write-back). For the panel's
 * nothing-selected state; `.design/canvas-template-values.md`.
 */
export function TemplateValues() {
  const { t } = useTranslation();
  const canvas = useCanvas();
  const files = useStore((s) => s.files);
  const drafts = useStore((s) => s.drafts);
  // the sources change with files and drafts; the groups are rebuilt only then
  const groups = useMemo(
    () => canvasTemplateValues(canvas, (f) => display(useStore.getState(), f)),
    [canvas, files, drafts],
  );
  const total = groups.reduce((n, g) => n + g.values.length, 0);
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const query = total > FILTER_FROM ? q.trim().toLowerCase() : "";
  const shown = groups
    .map((g) => ({
      ...g,
      values: query
        ? g.values.filter(([k]) => k.toLowerCase().includes(query))
        : g.values,
    }))
    .filter((g) => g.values.length);
  const isFolded = (file: string) =>
    query ? false : (folded[file] ?? total > OPEN_UP_TO);
  const show = (file: string) => {
    useStore.setState({
      selection: { kind: "board", file },
      panelTab: "tweaks",
      menu: null,
    });
    focusBoard(file);
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
          {query && !shown.length && (
            <p className="hint" style={{ margin: 0 }}>
              {t("panel.templateValues.none", { q })}
            </p>
          )}
          {shown.map((g) => {
            const closed = isFolded(g.file);
            return (
              <div
                key={g.file}
                className="tvgroup"
                role="group"
                aria-label={g.title}
              >
                <div className="tvhead">
                  <button
                    className="ib sm"
                    aria-expanded={!closed}
                    aria-label={t(
                      closed
                        ? "panel.templateValues.unfold"
                        : "panel.templateValues.fold",
                      { name: g.title },
                    )}
                    onClick={() => setFolded({ ...folded, [g.file]: !closed })}
                  >
                    <Chevron open={!closed} />
                  </button>
                  <button
                    className="tvname"
                    title={t("panel.templateValues.show", { name: g.title })}
                    onClick={() => show(g.file)}
                  >
                    {g.title}
                  </button>
                  <span className="faint">
                    {t("panel.templateValues.count", {
                      count: g.values.length,
                    })}
                  </span>
                </div>
                {!closed &&
                  g.values.map(([k, s]) => (
                    <TweakField key={k} file={g.file} name={k} spec={s} />
                  ))}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
