import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "./App";

vi.mock("talking-head-glb", () => ({
  TalkingHead: ({ head, motion }: { head: string; motion: Record<string, boolean> }) => (
    <div data-testid="avatar" data-model={head} data-head={motion.headMovementEnabled} data-gaze={motion.gazeEnabled} data-expressions={motion.expressionsEnabled} data-blinking={motion.blinkingEnabled} />
  ),
}));
vi.mock("./components", () => ({
  IconTray: () => <div data-testid="controls" />,
}));

const onDisk = (refs: string[]) =>
  vi.fn().mockResolvedValue(Response.json(refs.map((ref) => ({ ref, file: `${ref.replace("/", ".")}.glb` }))));

beforeEach(() => {
  globalThis.fetch = onDisk(["ava/ava", "rocketbox/medical-male-01"]);
});

test("loads Ava by default and the picker switches to another head", async () => {
  render(<App />);

  const avatar = await screen.findByTestId("avatar");
  expect(avatar).toHaveAttribute("data-model", "ava/ava");
  expect(screen.getByTestId("controls")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /avatar: ava/i }));
  fireEvent.click(screen.getByRole("radio", { name: "Medical male 01" }));
  expect(screen.getByTestId("avatar")).toHaveAttribute("data-model", "rocketbox/medical-male-01");
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /avatar: medical male 01/i })).toBeInTheDocument();
});

test("only installed heads are selectable, falling back when Ava is missing", async () => {
  globalThis.fetch = onDisk(["rocketbox/business-male-03", "rocketbox/medical-female-01"]);
  render(<App />);

  expect(await screen.findByTestId("avatar")).toHaveAttribute("data-model", "rocketbox/medical-female-01");
  fireEvent.click(screen.getByRole("button", { name: /avatar/i }));
  expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual(["rocketbox/medical-female-01", "rocketbox/business-male-03"]);
  expect(screen.getByRole("radio", { name: "Medical female 01" })).toBeChecked();
});

test("the picker offers Download for a browser head and the CLI command for a CLI-only head", async () => {
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: /avatar: ava/i }));
  expect(screen.getByRole("button", { name: "Download MakeHuman" })).toBeInTheDocument();
  const ict = screen.getByText("ICT FaceKit").parentElement!;
  expect(within(ict).getByText("npm run heads -- add ict/ict-facekit")).toBeInTheDocument();
  expect(within(ict).queryByRole("button")).not.toBeInTheDocument();
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
  ["missing", new Response("missing", { status: 404 })],
  ["the dev server's index.html", new Response("<!doctype html>", { headers: { "content-type": "text/html" } })],
])("tells you how to install a head when heads.json is %s", async (_, response) => {
  globalThis.fetch = vi.fn().mockResolvedValue(response);

  render(<App />);

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("No avatar installed");
  expect(alert).toHaveTextContent("Download a head from the picker, or run npm run heads -- add ava/ava for Ava.");
  expect(screen.getByRole("button", { name: /avatar: none/i })).toBeInTheDocument();
  expect(screen.queryByTestId("avatar")).not.toBeInTheDocument();
  expect(screen.queryByTestId("controls")).not.toBeInTheDocument();
});
