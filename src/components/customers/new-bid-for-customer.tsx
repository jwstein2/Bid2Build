"use client";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { Button } from "../ui/button";
import { rememberNewBidCustomer, type NewBidCustomer } from "@/lib/customers/new-bid";

/** Start a bid with this customer already filled in (and linked), after choosing a trade. */
export function NewBidForCustomer({ customer }: { customer: NewBidCustomer }) {
  const router = useRouter();
  return (
    <Button variant="accent" onClick={() => { rememberNewBidCustomer(customer); router.push("/bids"); }} data-testid="new-bid-for-customer">
      <FileText className="h-4 w-4" aria-hidden /> New bid for this customer
    </Button>
  );
}
