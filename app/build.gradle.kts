plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.saneiclover.videovault"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.saneiclover.videovault"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        // youtubedl-androidはABIごとのネイティブバイナリを含む。自分の端末(arm64)のみ対象
        ndk { abiFilters += listOf("arm64-v8a") }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            // x86_64エミュレータで画面確認するためdebugのみABIを追加(実機はarm64。releaseはarm64のみのまま)
            ndk { abiFilters += "x86_64" }
        }
        release {
            isMinifyEnabled = false
            // 署名は初回リリース時にkeystore.properties経由で設定(CLAUDE.md参照)。それまではdebugビルドで実機運用
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    packaging {
        // youtubedl-android要件: python環境のネイティブライブラリを非圧縮で展開する
        jniLibs { useLegacyPackaging = true }
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.youtubedl.library)
    implementation(libs.youtubedl.ffmpeg)
}
