import { Send } from "lucide-react";
import { useParams } from "next/navigation";
import { useQueryState } from "nuqs";
import { useEffect, useRef, useState } from "react";
import { ConversationListItem as ConversationItem } from "@/app/types/global";
import { toast } from "@/components/hooks/use-toast";
import LoadingSpinner from "@/components/loadingSpinner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSelected } from "@/components/useSelected";
import { useShiftSelected } from "@/components/useShiftSelected";
import { conversationsListChannelId } from "@/lib/realtime/channels";
import { useRealtimeEvent } from "@/lib/realtime/hooks";
import { generateSlug } from "@/lib/shared/slug";
import { api } from "@/trpc/react";
import { useConversationsListInput } from "../shared/queries";
import { ConversationFilters, useConversationFilters } from "./conversationFilters";
import { useConversationListContext } from "./conversationListContext";
import { ConversationListItem } from "./conversationListItem";
import { ConversationSearchBar } from "./conversationSearchBar";
import { NoConversations } from "./emptyState";
import NewConversationModalContent from "./newConversationModal";

type ListItem = ConversationItem & { isNew?: boolean };

export const List = () => {
  const [conversationSlug] = useQueryState("id");
  const { searchParams, input } = useConversationsListInput();
  const { conversationListData, navigateToConversation, isPending, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useConversationListContext();

  const [showFilters, setShowFilters] = useState(false);
  const { filterValues, activeFilterCount, updateFilter, clearFilters } = useConversationFilters();
  const [allConversationsSelected, setAllConversationsSelected] = useState(false);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const utils = api.useUtils();
  const { mutate: bulkUpdate } = api.mailbox.conversations.bulkUpdate.useMutation({
    onError: () => {
      toast({
        variant: "destructive",
        title: "Failed to update conversations",
      });
    },
  });

  const conversations = conversationListData?.conversations ?? [];
  const defaultSort = conversationListData?.defaultSort;

  const loadMoreRef = useRef<HTMLDivElement>(null);
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  const {
    selected: selectedConversations,
    change: changeSelectedConversations,
    clear: clearSelectedConversations,
    set: setSelectedConversations,
  } = useSelected<number>([]);

  const onShiftSelectConversation = useShiftSelected<number>(
    conversations.map((c) => c.id),
    changeSelectedConversations,
  );

  const toggleConversation = (id: number, isSelected: boolean, shiftKey: boolean) => {
    if (allConversationsSelected) {
      // If all conversations are selected, toggle the selected conversation
      setAllConversationsSelected(false);
      setSelectedConversations(conversations.flatMap((c) => (c.id === id ? [] : [c.id])));
    } else {
      onShiftSelectConversation(id, isSelected, shiftKey);
    }
  };

  const toggleAllConversations = () => {
    setAllConversationsSelected((prev) => !prev);
    clearSelectedConversations();
  };

  const handleBulkUpdate = (status: "open" | "closed" | "spam") => {
    setIsBulkUpdating(true);
    try {
      const conversationFilter = allConversationsSelected ? conversations.map((c) => c.id) : selectedConversations;
      const selectedCount = allConversationsSelected ? conversations.length : selectedConversations.length;

      bulkUpdate(
        {
          conversationFilter,
          status,
          mailboxSlug: input.mailboxSlug,
        },
        {
          onSuccess: ({ updatedImmediately }) => {
            setAllConversationsSelected(false);
            clearSelectedConversations();
            void utils.mailbox.conversations.list.invalidate();
            void utils.mailbox.conversations.count.invalidate();

            if (updatedImmediately) {
              const actionText = status === "open" ? "reopened" : status === "closed" ? "closed" : "marked as spam";
              toast({
                title: `${selectedCount} ticket${selectedCount === 1 ? "" : "s"} ${actionText}`,
              });
            } else {
              toast({ title: "Starting update, refresh to see status." });
            }
          },
        },
      );
    } finally {
      setIsBulkUpdating(false);
    }
  };

  useEffect(() => {
    const currentRef = loadMoreRef.current;
    if (!currentRef || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "500px", root: resultsContainerRef.current },
    );

    observer.observe(currentRef);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useRealtimeEvent(conversationsListChannelId(input.mailboxSlug), "conversation.new", (message) => {
    const newConversation = message.data as ConversationItem;
    if (newConversation.status !== (searchParams.status ?? "open")) return;
    const sort = searchParams.sort ?? defaultSort;
    if (!sort) return;

    utils.mailbox.conversations.list.setInfiniteData(input, (data) => {
      if (!data) return undefined;
      const firstPage = data.pages[0];
      if (!firstPage) return data;

      switch (input.category) {
        case "conversations":
          break;
        case "assigned":
          if (!newConversation.assignedToId) return data;
          break;
        case "unassigned":
          if (newConversation.assignedToId) return data;
          break;
        case "mine":
          if (newConversation.assignedToId !== firstPage.assignedToIds?.[0]) return data;
          break;
      }

      const existingConversationIndex = firstPage.conversations.findIndex(
        (conversation) => conversation.slug === newConversation.slug,
      );

      const newConversations: ListItem[] = [...firstPage.conversations];
      if (existingConversationIndex >= 0) newConversations.splice(existingConversationIndex, 1);

      switch (sort) {
        case "newest":
          newConversations.unshift({ ...newConversation, isNew: true });
          break;
        case "oldest":
          // Only add to first page if no other pages exist
          if (data.pages.length === 1) {
            newConversations.push({ ...newConversation, isNew: true });
          }
          break;
        case "highest_value":
          const indexToInsert =
            existingConversationIndex >= 0
              ? existingConversationIndex
              : newConversations.findIndex(
                  (c) => (c.platformCustomer?.value ?? 0) < (newConversation.platformCustomer?.value ?? 0),
                );
          if (indexToInsert < 0) return data;
          newConversations.splice(indexToInsert, 0, { ...newConversation, isNew: true });
          break;
      }

      return {
        ...data,
        pages: [{ ...firstPage, conversations: newConversations }, ...data.pages.slice(1)],
      };
    });
  });

  return (
    <div className="flex flex-col w-full h-full">
      <div className="px-3 md:px-6 py-2 md:py-4 shrink-0 border-b border-border">
        <div className="flex flex-col gap-2 md:gap-4">
          <ConversationSearchBar
            toggleAllConversations={toggleAllConversations}
            allConversationsSelected={allConversationsSelected}
            activeFilterCount={activeFilterCount}
            defaultSort={defaultSort}
            showFilters={showFilters}
            setShowFilters={setShowFilters}
          />
          {(allConversationsSelected || selectedConversations.length > 0) && (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <label htmlFor="select-all" className="text-sm text-muted-foreground flex items-center">
                        {allConversationsSelected
                          ? "All conversations selected"
                          : `${selectedConversations.length} selected`}
                      </label>
                    </TooltipTrigger>
                  </Tooltip>
                </TooltipProvider>
                <div className="flex items-center gap-2">
                  {searchParams.status === "closed" ? (
                    <Button
                      variant="link"
                      className="h-auto"
                      onClick={() => handleBulkUpdate("open")}
                      disabled={isBulkUpdating}
                    >
                      Reopen
                    </Button>
                  ) : (
                    <Button
                      variant="link"
                      className="h-auto"
                      onClick={() => handleBulkUpdate("closed")}
                      disabled={isBulkUpdating}
                    >
                      Close
                    </Button>
                  )}
                  {searchParams.status !== "spam" && (
                    <Button
                      variant="link"
                      className="h-auto"
                      onClick={() => handleBulkUpdate("spam")}
                      disabled={isBulkUpdating}
                    >
                      Mark as spam
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
          {showFilters && (
            <ConversationFilters
              filterValues={filterValues}
              onUpdateFilter={updateFilter}
              onClearFilters={clearFilters}
              activeFilterCount={activeFilterCount}
            />
          )}
        </div>
      </div>
      {isPending ? (
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      ) : conversations.length === 0 ? (
        <NoConversations filtered={activeFilterCount > 0 || !!input.search} />
      ) : (
        <div ref={resultsContainerRef} className="flex-1 overflow-y-auto">
          {conversations.map((conversation) => (
            <ConversationListItem
              key={conversation.slug}
              conversation={conversation}
              isActive={conversationSlug === conversation.slug}
              onSelectConversation={navigateToConversation}
              isSelected={allConversationsSelected || selectedConversations.includes(conversation.id)}
              onToggleSelect={(isSelected, shiftKey) => toggleConversation(conversation.id, isSelected, shiftKey)}
            />
          ))}
          <div ref={loadMoreRef} />
          {isFetchingNextPage && (
            <div className="flex justify-center py-4">
              <LoadingSpinner size="md" />
            </div>
          )}
        </div>
      )}
      <NewConversationModal />
    </div>
  );
};

const NewConversationModal = () => {
  const params = useParams<{ mailbox_slug: string }>();
  const mailboxSlug = params.mailbox_slug;

  const [newConversationModalOpen, setNewConversationModalOpen] = useState(false);
  const [newConversationSlug, setNewConversationSlug] = useState(generateSlug());
  useEffect(() => {
    if (newConversationModalOpen) setNewConversationSlug(generateSlug());
  }, [newConversationModalOpen]);

  const closeModal = () => setNewConversationModalOpen(false);

  return (
    <Dialog open={newConversationModalOpen} onOpenChange={setNewConversationModalOpen}>
      <DialogTrigger asChild>
        <Button
          variant="default"
          iconOnly
          className="fixed z-50 bottom-6 right-6 rounded-full text-primary-foreground dark:bg-bright dark:text-bright-foreground bg-bright hover:bg-bright/90 hover:text-background"
        >
          <Send className="text-primary dark:text-primary-foreground h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
        </DialogHeader>
        <NewConversationModalContent
          mailboxSlug={mailboxSlug}
          conversationSlug={newConversationSlug}
          onSubmit={closeModal}
        />
      </DialogContent>
    </Dialog>
  );
};
