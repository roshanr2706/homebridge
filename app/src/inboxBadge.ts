// The smart inbox's unread count, shared by the tab bar badge and the super-app home's 消息 tile. The Inbox screen
// polls the server and reports it to the shell, which provides it here.
import { createContext, useContext } from 'react';

const InboxBadgeCtx = createContext(0);

export const InboxBadgeScope = InboxBadgeCtx.Provider;

export function useInboxBadge(): number {
  return useContext(InboxBadgeCtx);
}
