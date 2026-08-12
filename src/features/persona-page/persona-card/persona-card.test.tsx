import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Stub every leaf component that adds heavy deps
vi.mock("./persona-card-context-menu", () => ({
  PersonaCardContextMenu: () => <div data-testid="context-menu" />,
}));

vi.mock("./persona-view", () => ({
  ViewPersona: () => <div data-testid="view-persona" />,
}));

vi.mock("./start-new-persona-chat", () => ({
  StartNewPersonaChat: () => <div data-testid="start-chat" />,
}));

vi.mock("./copy-agent-links-menu", () => ({
  CopyAgentLinksMenu: () => <button aria-label="Copy agent links" />,
}));

vi.mock("./persona-visibility-info", () => ({
  PersonaVisibilityInfo: ({ persona }: any) => (
    <div
      data-testid="visibility-info"
      data-published={String(persona.isPublished)}
    />
  ),
}));

vi.mock("./favorite-agent-button", () => ({
  FavoriteAgentButton: ({ agentId, isFavorited }: any) => (
    <button
      data-testid="fav-btn"
      data-agent={agentId}
      aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
    />
  ),
}));

vi.mock("@/features/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipProvider: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
}));

import { PersonaCard } from "./persona-card";
import type { PersonaModel } from "../persona-services/models";

const basePersona: PersonaModel = {
  id: "p1",
  name: "My Agent",
  description: "Helpful assistant",
  personaMessage: "instructions",
  createdAt: new Date(),
  isPublished: false,
  type: "PERSONA",
  userId: "u1",
  creatorName: "Ada Lovelace",
  extensionIds: [],
};

describe("persona-page.unit.components.006 — PersonaCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T12:00:00Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("renders persona name and description", () => {
    render(
      <PersonaCard
        persona={basePersona}
        showContextMenu={false}
        showActionMenu={false}
      />
    );
    expect(screen.getByText("My Agent")).toBeInTheDocument();
    expect(screen.getByText("Helpful assistant")).toBeInTheDocument();
  });

  it("shows context menu (ViewPersona) when showContextMenu=true", () => {
    render(
      <PersonaCard
        persona={basePersona}
        showContextMenu={true}
        showActionMenu={false}
      />
    );
    expect(screen.getByTestId("view-persona")).toBeInTheDocument();
  });

  it("hides context menu (ViewPersona) when showContextMenu=false", () => {
    render(
      <PersonaCard
        persona={basePersona}
        showContextMenu={false}
        showActionMenu={false}
      />
    );
    expect(screen.queryByTestId("view-persona")).not.toBeInTheDocument();
  });

  it("shows PersonaCardContextMenu when showActionMenu=true", () => {
    render(
      <PersonaCard
        persona={basePersona}
        showContextMenu={false}
        showActionMenu={true}
      />
    );
    expect(screen.getByTestId("context-menu")).toBeInTheDocument();
  });

  it("hides PersonaCardContextMenu when showActionMenu=false", () => {
    render(
      <PersonaCard
        persona={basePersona}
        showContextMenu={false}
        showActionMenu={false}
      />
    );
    expect(screen.queryByTestId("context-menu")).not.toBeInTheDocument();
  });

  it("always renders StartNewPersonaChat", () => {
    render(
      <PersonaCard
        persona={basePersona}
        showContextMenu={false}
        showActionMenu={false}
      />
    );
    expect(screen.getByTestId("start-chat")).toBeInTheDocument();
  });

  it("renders FavoriteAgentButton when onToggleFavorite is provided", () => {
    render(
      <PersonaCard
        persona={basePersona}
        showContextMenu={false}
        showActionMenu={false}
        isFavorited={false}
        onToggleFavorite={vi.fn()}
      />
    );
    expect(screen.getByTestId("fav-btn")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add to favorites/i })
    ).toBeInTheDocument();
  });

  it("renders FavoriteAgentButton in favorited state", () => {
    render(
      <PersonaCard
        persona={basePersona}
        showContextMenu={false}
        showActionMenu={false}
        isFavorited={true}
        onToggleFavorite={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: /remove from favorites/i })
    ).toBeInTheDocument();
  });

  it("does NOT render FavoriteAgentButton when onToggleFavorite is omitted", () => {
    render(
      <PersonaCard
        persona={basePersona}
        showContextMenu={false}
        showActionMenu={false}
      />
    );
    expect(screen.queryByTestId("fav-btn")).not.toBeInTheDocument();
  });

  it("renders PersonaVisibilityInfo component", () => {
    render(
      <PersonaCard
        persona={basePersona}
        showContextMenu={false}
        showActionMenu={false}
      />
    );
    expect(screen.getByTestId("visibility-info")).toBeInTheDocument();
  });

  it("renders creator, created, and last-changed metadata as icon tooltips", () => {
    render(
      <PersonaCard
        persona={{
          ...basePersona,
          createdAt: new Date("2026-07-23T12:00:00Z"),
          updatedAt: new Date("2026-08-11T12:00:00Z"),
        }}
        showContextMenu={false}
        showActionMenu={false}
      />
    );

    expect(screen.getByLabelText("Creator: Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByLabelText(/Created: .+ \(20d ago\)/)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Last changed: .+ \(1d ago\)/)
    ).toBeInTheDocument();
  });

  it("uses the creation date and a safe creator fallback for legacy agents", () => {
    render(
      <PersonaCard
        persona={{
          ...basePersona,
          creatorName: undefined,
          createdAt: new Date("2026-08-11T12:00:00Z"),
          updatedAt: undefined,
        }}
        showContextMenu={false}
        showActionMenu={false}
      />
    );

    expect(screen.getByLabelText("Creator: Unknown creator")).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Last changed: .+ \(1d ago\)/)
    ).toBeInTheDocument();
  });
});
