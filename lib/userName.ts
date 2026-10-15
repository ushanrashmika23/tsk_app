"use client";

import { useEffect, useState, useCallback } from "react";

export const USER_NAME_STORAGE_KEY = "tsk_user_name";
export const USER_NAME_CHANGE_EVENT = "tsk:username-change";

/**
 * Reads user name from localStorage in a browser environment.
 */
export function getStoredUserName(): string {
  if (typeof window === "undefined") return "";
  try {
    return (localStorage.getItem(USER_NAME_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

/**
 * Saves user name to localStorage and notifies other listeners.
 */
export function setStoredUserName(name: string): void {
  const trimmed = name.trim();
  if (typeof window !== "undefined") {
    try {
      if (trimmed) {
        localStorage.setItem(USER_NAME_STORAGE_KEY, trimmed);
      } else {
        localStorage.removeItem(USER_NAME_STORAGE_KEY);
      }
      window.dispatchEvent(
        new CustomEvent(USER_NAME_CHANGE_EVENT, { detail: { name: trimmed } })
      );
    } catch {
      // Storage unavailable or quota exceeded
    }
  }
}

/**
 * React hook to access and update the user's name across components.
 */
export function useUserName(): {
  name: string;
  setUserName: (name: string) => void;
  isLoaded: boolean;
} {
  const [name, setNameState] = useState<string>("");
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  useEffect(() => {
    setNameState(getStoredUserName());
    setIsLoaded(true);

    const handleCustomChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ name: string }>;
      setNameState(customEvent.detail?.name ?? getStoredUserName());
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === USER_NAME_STORAGE_KEY) {
        setNameState((e.newValue || "").trim());
      }
    };

    window.addEventListener(USER_NAME_CHANGE_EVENT, handleCustomChange);
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener(USER_NAME_CHANGE_EVENT, handleCustomChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  const updateName = useCallback((newName: string) => {
    setStoredUserName(newName);
    setNameState(newName.trim());
  }, []);

  return {
    name,
    setUserName: updateName,
    isLoaded,
  };
}

