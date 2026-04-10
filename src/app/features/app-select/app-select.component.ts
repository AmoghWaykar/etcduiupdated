import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { AppStateService } from '../../core/services/app-state.service';
import { isValidAppName, normalizeAppName } from '../../core/services/etcd-api.service';

@Component({
  selector: 'app-app-select',
  imports: [
    FormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSnackBarModule,
    MatChipsModule,
    MatIconModule,
  ],
  templateUrl: './app-select.component.html',
  styleUrl: './app-select.component.scss',
})
export class AppSelectComponent {
  readonly appState = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  draft = normalizeAppName(this.appState.appName());

  pickRecent(name: string): void {
    this.draft = name;
  }

  continue(): void {
    const name = normalizeAppName(this.draft);
    if (!name) {
      this.snack.open('Enter an application name.', 'Dismiss', { duration: 4000 });
      return;
    }
    if (!isValidAppName(name)) {
      this.snack.open(
        'Use letters, numbers, dot, underscore, or hyphen. Must start with alphanumeric.',
        'Dismiss',
        { duration: 6000 },
      );
      return;
    }
    this.appState.setAppName(name);
    void this.router.navigate(['/explorer']);
  }
}
