/* eslint-disable @fnando/consistent-import/consistent-import */
import { act, renderHook } from "@testing-library/react-hooks";
import { useFocusedPolling } from "hooks/useFocusedPolling";
import { AppState, AppStateStatus } from "react-native";

jest.mock("@react-navigation/native", () => ({
  useFocusEffect: (fn: () => void) => {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    require("react").useEffect(fn, [fn]);
  },
}));
it("refreshes on focus, every 30 seconds and immediately on foreground", () => {
  jest.useFakeTimers();
  let appState: (state: AppStateStatus) => void = () => {};
  const remove = jest.fn();
  const listener = jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event, callback) => {
      appState = callback;
      return { remove };
    });
  const poll = jest.fn();
  const { unmount } = renderHook(() =>
    useFocusedPolling({ onPoll: poll, interval: 30000, refreshOnFocus: true }),
  );
  expect(poll).toHaveBeenCalledTimes(1);
  act(() => {
    jest.advanceTimersByTime(30000);
  });
  expect(poll).toHaveBeenCalledTimes(2);
  act(() => {
    appState("background");
    jest.advanceTimersByTime(60000);
  });
  expect(poll).toHaveBeenCalledTimes(2);
  act(() => {
    appState("active");
  });
  expect(poll).toHaveBeenCalledTimes(3);
  unmount();
  act(() => {
    jest.advanceTimersByTime(60000);
  });
  expect(poll).toHaveBeenCalledTimes(3);
  expect(remove).toHaveBeenCalled();
  listener.mockRestore();
  jest.useRealTimers();
});

// Without refreshOnFocus the hook must behave as it did before that flag
// existed: navigation focus drives it, and returning from the background does
// not. The balances polling behind the tab bar is such a caller.
it("does not watch app state unless refreshOnFocus is set", () => {
  jest.useFakeTimers();
  const listener = jest.spyOn(AppState, "addEventListener");
  const poll = jest.fn();
  renderHook(() => useFocusedPolling({ onPoll: poll, interval: 30000 }));
  expect(listener).not.toHaveBeenCalled();
  listener.mockRestore();
  jest.useRealTimers();
});
