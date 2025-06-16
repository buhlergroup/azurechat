import { proxy, useSnapshot } from "valtio";

class Menu {
  public isMenuOpen: boolean; // For MenuTray (chat history)
  public isMainMenuOpen: boolean; // For MainMenu (navigation sidebar)

  constructor() {
    // Chat history: collapsed on mobile by default, open on desktop
    this.isMenuOpen = typeof window !== 'undefined' ? window.innerWidth >= 768 : true;
    // Main menu: hidden on mobile by default
    this.isMainMenuOpen = false;
  }

  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;
  }

  toggleMainMenu() {
    this.isMainMenuOpen = !this.isMainMenuOpen;
    
    // When hiding main menu on mobile, also collapse chat history
    if (!this.isMainMenuOpen && typeof window !== 'undefined' && window.innerWidth < 768) {
      this.isMenuOpen = false;
    }
  }

  setMainMenuOpen(isOpen: boolean) {
    this.isMainMenuOpen = isOpen;
    
    // When hiding main menu on mobile, also collapse chat history
    if (!isOpen && typeof window !== 'undefined' && window.innerWidth < 768) {
      this.isMenuOpen = false;
    }
  }
}

export const menuStore = proxy(new Menu());

// Hook to use the menu state
export const useMenuState = () => {
  return useSnapshot(menuStore);
};
