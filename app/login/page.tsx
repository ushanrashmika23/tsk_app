import { LogIn } from "lucide-react";
import { loginAction } from "./actions";
import { LoginForm } from "./LoginForm";

export const metadata = {
  title: "Login | Task & Schedule",
};

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-zinc-900 p-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-800 rounded-2xl shadow-sm border border-gray-200 dark:border-zinc-700 p-8">
        <div className="flex flex-col items-center justify-center mb-8">
          <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl flex items-center justify-center mb-4">
            <LogIn className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Welcome Back</h1>
          <p className="text-gray-500 dark:text-zinc-400 mt-2 text-center">
            Enter your personal application password to continue.
          </p>
        </div>

        <LoginForm />
      </div>
    </div>
  );
}
