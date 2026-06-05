<?php
/**
 * No-op wp_mail() for Playground's --experimental-posix-kernel browser
 * mode. Mirrors the CLI's wp-templates/disable-wp-mail.php. Prevents
 * wp_install()'s wp_new_blog_notification() from spawning sendmail via
 * PHPMailer's popen path, which the kernel's fork+exec cannot resolve
 * and which crashes the FPM worker mid-install.
 */
// DIAG: write to a file (not error_log) because the FPM pool config
// does not enable catch_workers_output, so PHP worker error_log()
// writes never reach /var/log/php-fpm.log. The database dir is
// world-writable (chmod 0777 in vfs-builder.ts) so uid 99 can append.
// Remove once root cause is identified.
@file_put_contents(
    '/var/www/html/wp-content/database/diag-mu-trace.log',
    '[diag-mu] 0-disable-wp-mail.php loaded; REQUEST_METHOD=' . ($_SERVER['REQUEST_METHOD'] ?? '?') . ' REQUEST_URI=' . ($_SERVER['REQUEST_URI'] ?? '?') . "\n",
    FILE_APPEND
);
if (!function_exists('wp_mail')) {
    function wp_mail($to, $subject, $message, $headers = '', $attachments = array()) {
        @file_put_contents(
            '/var/www/html/wp-content/database/diag-mu-trace.log',
            "[diag-mu] no-op wp_mail() called\n",
            FILE_APPEND
        );
        return true;
    }
}
