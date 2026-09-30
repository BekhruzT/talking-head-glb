import { render, screen } from "@testing-library/react";
import App from "./App";

jest.mock("./components", () => ({
  Avatar: ({ modelPath }: { modelPath: string }) => <div data-testid="avatar" data-model={modelPath} />,
  IconTray: () => <div data-testid="controls" />,
}));

test("loads Ava as the only avatar without a selection step", () => {
  render(<App />);

  expect(screen.getByTestId("avatar")).toHaveAttribute("data-model", "/models/ava/ava.glb");
  expect(screen.getByTestId("controls")).toBeInTheDocument();
  expect(screen.queryByText(/select avatar/i)).not.toBeInTheDocument();
});
