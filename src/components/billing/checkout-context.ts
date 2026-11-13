"use client";
import { createContext, useContext } from "react";
import type { PlanId } from "@/lib/billing/plans";

/** Present on pages that host the full checkout flow (pricing): buttons hand their plan to it. */
export type CheckoutFlow = { choose: (plan: PlanId) => void };
export const CheckoutFlowContext = createContext<CheckoutFlow | null>(null);
export const useCheckoutFlow = () => useContext(CheckoutFlowContext);
