"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function loginAction(prevState: any, formData: FormData) {
  const password = formData.get("password") as string;
  const expectedPassword = process.env.APP_PASSWORD;

  if (!expectedPassword) {
    return { error: "Authentication is not configured properly on the server." };
  }

  if (password !== expectedPassword) {
    return { error: "Incorrect password." };
  }

  // Hash the password to create the token (must match middleware logic)
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "app_salt_task_manager");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const token = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

  // Set HTTP-only cookie
  const cookieStore = await cookies();
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });

  redirect("/");
}
