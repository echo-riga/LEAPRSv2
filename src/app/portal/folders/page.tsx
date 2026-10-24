import { redirect } from 'next/navigation';

// Preserve old bookmarks without a separate folder-management screen.
export default function Page() {
  redirect('/portal');
}
