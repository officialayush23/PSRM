// authApi.js
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth } from "../firebase";
import client from "./client";

export async function signup({ full_name, email, password, city_code, preferred_language }) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const idToken    = await credential.user.getIdToken();

  const { data } = await client.post("/auth/signup", {
    id_token:           idToken,
    full_name,
    city_code:          city_code || "DEL",
    preferred_language: preferred_language || "hi",
  });

  localStorage.setItem("auth_user", JSON.stringify(data));
  return data;
}

export async function login(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const idToken    = await credential.user.getIdToken();

  const { data } = await client.post("/auth/login", { id_token: idToken });

  localStorage.setItem("auth_user", JSON.stringify(data));
  return data;
}

export async function logout() {
  await signOut(auth);
  localStorage.removeItem("auth_user");
}

export async function getMe() {
  const { data } = await client.get("/auth/me");
  return data;
}

// Called by ProfilePage to save changes
export async function updateMe(payload) {
  const { data } = await client.patch("/auth/me", payload);
  return data;
}