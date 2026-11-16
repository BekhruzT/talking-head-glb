import { fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

jest.mock("./components", () => ({
  Avatar: ({ modelPath, settings, headMovementEnabled, gazeEnabled, expressionsEnabled, blinkingEnabled }: {
    modelPath: string;
    settings?: { position?: number[] };
    headMovementEnabled: boolean;
    gazeEnabled: boolean;
    expressionsEnabled: boolean;
    blinkingEnabled: boolean;
  }) => <div data-testid="avatar" data-model={modelPath} data-position={JSON.stringify(settings?.position)} data-head={headMovementEnabled} data-gaze={gazeEnabled} data-expressions={expressionsEnabled} data-blinking={blinkingEnabled} />,
  IconTray: () => <div data-testid="controls" />,
}));

const AVA = { id: "ava", family: "ava", label: "Ava", path: "/models/ava/ava.glb" };
const MEDIC = { id: "medical-female-01", family: "rocketbox", label: "Medical female 01", path: "/models/rocketbox/medical-female-01.glb" };

// Serves the given JSON files; any other URL gets the dev server's index.html fallback.
const serve = (files: { [url: string]: unknown }) => {
  global.fetch = jest.fn(async (url: string) => url in files
    ? { ok: true, headers: { get: () => "application/json" }, json: async () => files[url] }
    : { ok: true, headers: { get: () => "text/html" }, json: async () => { throw new SyntaxError("not JSON"); } }) as jest.Mock;
};

beforeEach(() => serve({
  "/models/heads.json": [AVA, MEDIC],
  "/models/ava/family.json": { overrides: { ava: { position: [0, -1.5, 0] } } },
  "/models/rocketbox/family.json": { source: { url: "https://example.com/{id}.glb" } },
}));

afterEach(() => window.history.pushState({}, "", "/"));

test("loads Ava by default when the manifest lists her", async () => {
  render(<App />);

  expect(await screen.findByTestId("avatar")).toHaveAttribute("data-model", "/models/ava/ava.glb");
  expect(screen.getByTestId("controls")).toBeInTheDocument();
});

test("loads the first listed head when the manifest has no Ava", async () => {
  serve({ "/models/heads.json": [MEDIC] });
  render(<App />);

  expect(await screen.findByTestId("avatar")).toHaveAttribute("data-model", MEDIC.path);
});

test("a head's overrides come from its family.json", async () => {
  render(<App />);

  expect(await screen.findByTestId("avatar")).toHaveAttribute("data-position", "[0,-1.5,0]");
});

test("a head whose family.json gives no overrides loads with the defaults", async () => {
  window.history.pushState({}, "", "/?model=medical-female-01");
  render(<App />);

  const avatar = await screen.findByTestId("avatar");
  expect(avatar).toHaveAttribute("data-model", MEDIC.path);
  expect(avatar).not.toHaveAttribute("data-position");
});

test("a head whose family.json is missing loads with the defaults", async () => {
  serve({ "/models/heads.json": [MEDIC] });
  render(<App />);

  expect(await screen.findByTestId("avatar")).not.toHaveAttribute("data-position");
});

test("?model= picks that manifest entry", async () => {
  window.history.pushState({}, "", "/?model=medical-female-01");
  render(<App />);

  expect(await screen.findByTestId("avatar")).toHaveAttribute("data-model", MEDIC.path);
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
  { ok: false, contentType: "application/json" },
  { ok: true, contentType: "text/html" },
])("shows model setup guidance when no head is installed: %p", async ({ ok, contentType }) => {
  global.fetch = jest.fn().mockResolvedValue({ ok, headers: { get: () => contentType }, json: async () => [] });

  render(<App />);

  expect(await screen.findByRole("alert")).toHaveTextContent(/npm run setup:model -- ava/i);
  expect(screen.getByRole("link", { name: /request access/i })).toBeInTheDocument();
  expect(screen.queryByTestId("avatar")).not.toBeInTheDocument();
  expect(screen.queryByTestId("controls")).not.toBeInTheDocument();
});
