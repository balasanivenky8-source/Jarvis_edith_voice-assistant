plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.jarvis.assistant"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.jarvis.assistant"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        getByName("debug") {
            val localKeystore = file("debug.keystore")
            if (localKeystore.exists()) {
                storeFile = localKeystore
            }
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
