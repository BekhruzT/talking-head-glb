import { render, screen } from "@testing-library/react";
import App from "./App";

jest.mock("./components", () => ({
  Avatar: ({ modelPath }: { modelPath: string }) => <div data-testid="avatar" data-model={modelPath} />,
  IconTray: () => <div data-testid="controls" />,
}));

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => "model/gltf-binary" },
  });
});

test("loads Ava as the only avatar after the model is found", async () => {
  render(<App />);

  expect(await screen.findByTestId("avatar")).toHaveAttribute("data-model", "/models/ava/ava.glb");
  expect(screen.getByTestId("controls")).toBeInTheDocument();
  expect(screen.queryByText(/select avatar/i)).not.toBeInTheDocument();
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
