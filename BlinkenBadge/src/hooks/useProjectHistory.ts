import { useCallback, useReducer } from "react";
import type { Project } from "../types";

const HISTORY_LIMIT = 100;
interface History {
  project: Project;
  past: Project[];
  future: Project[];
}
type Action =
  | { type: "apply"; project: Project; history: boolean }
  | { type: "reset"; project: Project }
  | { type: "undo" | "redo" };

/** Pure transitions also behave correctly when React replays updates. */
export function historyReducer(state: History, action: Action): History {
  switch (action.type) {
    case "reset":
      return { project: action.project, past: [], future: [] };
    case "apply":
      return {
        project: action.project,
        past: action.history
          ? [...state.past, state.project].slice(-HISTORY_LIMIT)
          : state.past,
        future: [],
      };
    case "undo": {
      const previous = state.past[state.past.length - 1];
      return previous
        ? {
            project: previous,
            past: state.past.slice(0, -1),
            future: [state.project, ...state.future],
          }
        : state;
    }
    case "redo": {
      const next = state.future[0];
      return next
        ? {
            project: next,
            past: [...state.past, state.project].slice(-HISTORY_LIMIT),
            future: state.future.slice(1),
          }
        : state;
    }
  }
}

export function useProjectHistory(initial: Project) {
  const [state, dispatch] = useReducer(historyReducer, {
    project: initial,
    past: [],
    future: [],
  });
  const apply = useCallback(
    (project: Project, history: boolean) =>
      dispatch({ type: "apply", project, history }),
    [],
  );
  const resetHistory = useCallback(
    (project: Project) => dispatch({ type: "reset", project }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  return {
    project: state.project,
    apply,
    resetHistory,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
