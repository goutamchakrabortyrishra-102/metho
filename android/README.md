# METHO AAY-UPAY Android Wrapper

This Android project opens the existing production site at `https://methoaayupay.com/` in a secure Chrome Custom Tab. The React frontend, backend API, authentication, admin, partner, image upload, cart, and checkout flows remain unchanged.

## Build prerequisites

Install Android Studio with:

- Android SDK Platform 35
- Android SDK Build-Tools
- JDK 17

Then open this `android/` folder in Android Studio and run:

```powershell
./gradlew assembleDebug
./gradlew bundleRelease
```

On Windows PowerShell, use `gradlew.bat` after generating or importing the Gradle wrapper.

## Play Store release

1. Set the final package ID if required. Current ID: `com.metho.aayupay`.
2. Create a release keystore and keep it outside Git.
3. Build a signed Android App Bundle (`.aab`).
4. Copy the release certificate SHA-256 fingerprint.
5. Add the fingerprint to `public/.well-known/assetlinks.json` and deploy the website.
6. Verify `https://methoaayupay.com/.well-known/assetlinks.json` before uploading the `.aab` to Play Console.

Do not publish an `assetlinks.json` with a placeholder fingerprint.
