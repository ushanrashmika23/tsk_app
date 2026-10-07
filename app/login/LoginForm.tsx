"use client";

import { useActionState, useEffect } from "react";
import { loginAction } from "./actions";
import { Loader2 } from "lucide-react";

export function LoginForm() {
  const [state, action, isPending] = useActionState(loginAction, { error: "" });

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          className="w-full px-4 py-2 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
          placeholder="••••••••"
        />
      </div>

      {state?.error && (
        <div className="p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl">
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full flex items-center justify-center py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
      >
        {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sign In"}
      </button>
    </form>
  );
}
