import { fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

jest.mock("./components", () => ({
  Avatar: ({ modelPath, headMovementEnabled, gazeEnabled, expressionsEnabled, blinkingEnabled }: {
    modelPath: string;
    headMovementEnabled: boolean;
    gazeEnabled: boolean;
    expressionsEnabled: boolean;
    blinkingEnabled: boolean;
  }) => <div data-testid="avatar" data-model={modelPath} data-head={headMovementEnabled} data-gaze={gazeEnabled} data-expressions={expressionsEnabled} data-blinking={blinkingEnabled} />,
  IconTray: () => <div data-testid="controls" />,
}));

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => "model/gltf-binary" },
  });
});

test("loads Ava by default and the picker switches to another head", async () => {
  render(<App />);

  const avatar = await screen.findByTestId("avatar");
  expect(avatar).toHaveAttribute("data-model", "/models/ava/ava.glb");
  expect(screen.getByTestId("controls")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /avatar: ava/i }));
  fireEvent.click(screen.getByRole("radio", { name: "Medical male 01" }));
  expect(screen.getByTestId("avatar")).toHaveAttribute("data-model", "/models/rocketbox/medical-male-01.glb");
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /avatar: medical male 01/i })).toBeInTheDocument();
});

test("the picker lists only heads whose files exist, falling back when Ava is missing", async () => {
  const present = ["/models/rocketbox/medical-female-01.glb", "/models/rocketbox/business-male-03.glb"];
  (global.fetch as jest.Mock).mockImplementation(async (url: string) => ({
    ok: present.includes(url),
    headers: { get: () => (present.includes(url) ? "model/gltf-binary" : "text/html") },
  }));
  render(<App />);

  expect(await screen.findByTestId("avatar")).toHaveAttribute("data-model", present[0]);
  fireEvent.click(screen.getByRole("button", { name: /avatar/i }));
  expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual(["medical-female-01", "business-male-03"]);
  expect(screen.getByRole("radio", { name: "Medical female 01" })).toBeChecked();
});

test("motion checkboxes switch head, gaze, expressions, and blinking independently", async () => {
  render(<App />);
  const avatar = await screen.findByTestId("avatar");

  fireEvent.click(screen.getByRole("button", { name: /motion/i }));
  const labels = ["Head & neck", "Eye gaze", "Facial expressions", "Blinking"];
  const attributes = ["data-head", "data-gaze", "data-expressions", "data-blinking"];

  labels.forEach((label, index) => {
    const checkbox = screen.getByRole("checkbox", { name: label });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(avatar).toHaveAttribute(attributes[index], "false");
    attributes.filter((_, other) => other !== index).forEach((attribute) => {
      expect(avatar).toHaveAttribute(attribute, "true");
    });
    fireEvent.click(checkbox);
  });
});

test.each([
  { ok: false, contentType: "text/html" },
  { ok: true, contentType: "text/html" },
])("shows model setup guidance when the asset is unavailable: %p", async ({ ok, contentType }) => {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok,
    headers: { get: () => contentType },
  });

  render(<App />);

  expect(await screen.findByRole("alert")).toHaveTextContent(/npm run setup:model/i);
  expect(screen.getByRole("link", { name: /request access/i })).toBeInTheDocument();
  expect(screen.queryByTestId("avatar")).not.toBeInTheDocument();
  expect(screen.queryByTestId("controls")).not.toBeInTheDocument();
});
