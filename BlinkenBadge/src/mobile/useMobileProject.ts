import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectHistory } from "../hooks/useProjectHistory";
import { newMessage } from "../badge";
import { parseProject, serializeProject } from "../doc";
import { platform } from "../platform";
import type { Project } from "../types";

export function emptyMobileProject(): Project {
  return {
    brightness: 100,
    messages: [
      { ...newMessage("scroll_left"), text: { value: "", face: "serif" } },
    ],
  };
}

/** The private draft is retained on normal exit, including a clean exit. */
export function useMobileProject() {
  const [initial] = useState(emptyMobileProject);
  const history = useProjectHistory(initial);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState("Opening");
  const [error, setError] = useState<string | null>(null);
  const writable = useRef(false);
  const latest = useRef(history.project);
  latest.current = history.project;
  const lastSaved = useRef("");
  const queue = useRef(Promise.resolve());
  const load = useRef<ReturnType<typeof platform.recoveryRead> | null>(null);
  const commit = useCallback(
    (fn: (p: Project) => Project, record = true) => {
      const next = fn(latest.current);
      latest.current = next;
      history.apply(next, record);
      setSaveState("Saving");
    },
    [history.apply],
  );
  const replace = useCallback(
    (project: Project) => {
      writable.current = true;
      latest.current = project;
      history.resetHistory(project);
      lastSaved.current = "";
      setSaveState("Saving");
    },
    [history.resetHistory],
  );
  useEffect(() => {
    let active = true;
    load.current ??= platform.recoveryRead();
    void load.current
      .then((saved) => {
        if (!active) return;
        if (saved) {
          const project = parseProject(saved.json);
          latest.current = project;
          history.resetHistory(project);
          lastSaved.current = serializeProject(project);
        }
        writable.current = true;
        setReady(true);
        setSaveState("Saved on Device");
      })
      .catch(() => {
        if (!active) return;
        setError(
          "The saved draft could not be opened; import a project or start a new one.",
        );
        setSaveState("Not Saved");
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [history.resetHistory]);
  const flush = useCallback(() => {
    if (!writable.current) return queue.current;
    const json = serializeProject(latest.current);
    if (lastSaved.current === json) return queue.current;
    setSaveState("Saving");
    queue.current = queue.current
      .then(async () => {
        if (lastSaved.current === json) return;
        await platform.recoveryWrite(json, null, new Date().toISOString());
        lastSaved.current = json;
        if (serializeProject(latest.current) === json)
          setSaveState("Saved on Device");
      })
      .catch(() => {
        setSaveState("Not Saved");
        setError("The draft could not be saved; export a copy before closing.");
      });
    return queue.current;
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void flush(), 400);
    return () => clearTimeout(timer);
  }, [history.project, ready, flush]);
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState !== "visible") void flush();
    };
    const pagehide = () => void flush();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", pagehide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", pagehide);
    };
  }, [flush]);
  return {
    ...history,
    commit,
    replace,
    ready,
    saveState,
    error,
    setError,
    flush,
  };
}
