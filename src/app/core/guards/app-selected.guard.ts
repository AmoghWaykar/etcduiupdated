import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AppStateService } from '../services/app-state.service';

export const appSelectedGuard: CanActivateFn = () => {
  const app = inject(AppStateService);
  const router = inject(Router);
  if (app.hasApp()) return true;
  return router.createUrlTree(['/']);
};
