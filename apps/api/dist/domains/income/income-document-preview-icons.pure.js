/** Thin outline icons for NodexPro document preview HTML (presentation only). */
export function docPreviewIcon(name, color = 'currentColor') {
    const stroke = color === 'currentColor' ? 'currentColor' : color;
    const common = `class="nx-doc__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
    switch (name) {
        case 'location':
            return `<svg ${common}><path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`;
        case 'phone':
            return `<svg ${common}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.86.3 1.7.54 2.5a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.58-1.06a2 2 0 0 1 2.11-.45c.8.24 1.64.42 2.5.54A2 2 0 0 1 22 16.92Z"/></svg>`;
        case 'mail':
            return `<svg ${common}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`;
        case 'website':
            return `<svg ${common}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>`;
        case 'calendar':
            return `<svg ${common}><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>`;
        case 'clock':
            return `<svg ${common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
        case 'user':
            return `<svg ${common}><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>`;
        case 'comment':
            return `<svg ${common}><path d="M21 11.5a8.4 8.4 0 0 1-2.1 5.5 8.5 8.5 0 0 1-13.4 0 8.4 8.4 0 0 1-2.1-5.5 8.5 8.5 0 0 1 17 0Z"/><path d="M8 14h.01M12 14h.01M16 14h.01"/></svg>`;
        case 'bank':
            return `<svg ${common}><path d="M3 10h18M5 10V19M9 10V19M15 10V19M19 10V19M2 19h20M12 3 22 10H2 10 12 3Z"/></svg>`;
        case 'card':
            return `<svg ${common}><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/></svg>`;
        case 'payment':
            return `<svg ${common}><path d="M7 7h10v10H7z"/><path d="M9 12h6M12 9v6"/></svg>`;
        case 'id':
            return `<svg ${common}><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 11h2M8 15h6M14 11h2"/></svg>`;
        case 'shield':
            return `<svg ${common}><path d="M12 3 20 7v6c0 4.5-3.5 7.5-8 8-4.5-.5-8-3.5-8-8V7l8-4Z"/><path d="m9.5 12 1.8 1.8L15 10.1"/></svg>`;
        default:
            return '';
    }
}
export function nodexproFooterLogoMarkup() {
    return `<svg class="nx-doc__platform-logo" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2 20 7v10l-8 5-8-5V7l8-5Z" stroke="#5B4DFF" stroke-width="1.5"/><path d="M8.5 12.2 11 14.7l4.5-4.9" stroke="#5B4DFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
