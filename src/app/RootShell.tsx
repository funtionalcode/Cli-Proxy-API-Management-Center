import { Outlet } from 'react-router-dom';
import { AppBackground } from '@/components/common/AppBackground';
import { ConfirmationModal } from '@/components/common/ConfirmationModal';
import { NotificationContainer } from '@/components/common/NotificationContainer';

export function RootShell() {
  return (
    <>
      <AppBackground />
      <div className="app-content">
        <NotificationContainer />
        <ConfirmationModal />
        <Outlet />
      </div>
    </>
  );
}
