// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { newMessage } from "../badge";
import { MiniBadge } from "./MobilePreview";
afterEach(cleanup);
it("shows all 484 unlit LEDs when the display is empty", () => {
  const { container } = render(<MiniBadge message={newMessage("fixed")} />);
  expect(
    screen.getByRole("img", { name: /44 by 11 pixel display, empty/ }),
  ).toBeTruthy();
  expect(container.querySelectorAll('[data-led="off"]')).toHaveLength(484);
  expect(container.querySelectorAll('[data-led="on"]')).toHaveLength(0);
});
it("keeps the unlit grid visible during the off phase of a blink", () => {
  const message = newMessage("fixed");
  message.frames[0][3][4] = true;
  const { container, rerender } = render(<MiniBadge message={message} />);
  expect(container.querySelectorAll('[data-led="on"]')).toHaveLength(1);
  rerender(<MiniBadge message={message} hidden />);
  expect(container.querySelectorAll('[data-led="off"]')).toHaveLength(484);
});
