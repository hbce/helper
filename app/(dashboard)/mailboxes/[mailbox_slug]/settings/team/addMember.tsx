"use client";

import { PlusCircle, X } from "lucide-react";
import { useState } from "react";
import { toast } from "@/components/hooks/use-toast";
import { showErrorToast } from "@/lib/utils/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/trpc/react";

type TeamInviteProps = {
  mailboxSlug: string;
  teamMembers: { id: string; email?: string }[];
};

export function AddMember({ mailboxSlug, teamMembers }: TeamInviteProps) {
  const [emailInput, setEmailInput] = useState("");
  const [displayNameInput, setDisplayNameInput] = useState("");

  const utils = api.useUtils();

  const { mutate: addMemberMutation, isPending: isAdding } = api.organization.addMember.useMutation({
    onSuccess: () => {
      toast({
        title: "Team member added",
        description: `${emailInput} can now log in`,
        variant: "success",
      });

      setEmailInput("");
      setDisplayNameInput("");

      utils.mailbox.members.list.invalidate({ mailboxSlug });
    },
    onError: (error) => {
      showErrorToast("sending invitation", error);
    },
  });

  const inviteMember = () => {
    if (!canAddMember || isAdding) {
      return;
    }

    const existingMember = teamMembers.find((member) => member.email?.toLowerCase() === emailInput.toLowerCase());

    if (existingMember) {
      toast({
        title: "Member already exists",
        description: "This user is already in your organization",
        variant: "destructive",
      });
    } else {
      addMemberMutation({
        email: emailInput,
        displayName: displayNameInput,
      });
    }
  };

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput);
  const canAddMember = isValidEmail && displayNameInput.trim().length > 0 && !isAdding;

  return (
    <div className="flex gap-4">
      <div className="relative flex-1">
        <Label className="sr-only" htmlFor="email-input">
          Email Address
        </Label>
        <Input
          id="email-input"
          placeholder="Email address"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          disabled={isAdding}
        />
        {emailInput && (
          <button
            className="absolute inset-y-0 right-0 flex items-center pr-3"
            onClick={() => setEmailInput("")}
            disabled={isAdding}
          >
            <X className="h-4 w-4 text-gray-400" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="relative flex-1">
        <Label className="sr-only" htmlFor="display-name-input">
          Display Name
        </Label>
        <Input
          id="display-name-input"
          placeholder="Name"
          value={displayNameInput}
          onChange={(e) => setDisplayNameInput(e.target.value)}
          disabled={isAdding}
        />
        {displayNameInput && (
          <button
            className="absolute inset-y-0 right-0 flex items-center pr-3"
            onClick={() => setDisplayNameInput("")}
            disabled={isAdding}
          >
            <X className="h-4 w-4 text-gray-400" aria-hidden="true" />
          </button>
        )}
      </div>
      <Button onClick={inviteMember} disabled={!canAddMember}>
        {isAdding ? (
          <>Adding...</>
        ) : (
          <>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Member
          </>
        )}
      </Button>
    </div>
  );
}
