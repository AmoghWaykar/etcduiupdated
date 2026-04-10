import { Routes } from '@angular/router';
import { appSelectedGuard } from './core/guards/app-selected.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/app-select/app-select.component').then((m) => m.AppSelectComponent),
  },
  {
    path: 'explorer',
    canActivate: [appSelectedGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  { path: '**', redirectTo: '' },
];
